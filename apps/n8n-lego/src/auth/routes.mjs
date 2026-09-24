/**
 * AUTH LEGO — the session, account and permission-model routes.
 *
 * Domain ownership: login/logout, owner setup, the current-user (`me`) twin of
 * `PublicUser`, the users list and the role catalog. Registration goes through
 * the compatibility router (`src/compat/route.mjs`); every envelope/error goes
 * through `src/compat/`. Scopes exposed to the editor come from the extracted
 * permission model (`src/compat/scopes.mjs`), never from a hardcoded list.
 *
 * User-management *administration* (invite, role change, delete, api keys,
 * password change, MFA) is P5 and answers via the compatibility layer's
 * unsupported semantics until then — see `src/compat/capability.mjs`.
 */
import { badRequest, forbidden, notFound, unauthorized } from '../compat/error.mjs';
import { sendData } from '../compat/response.mjs';
import { publicUser, requireUser } from '../compat/auth-context.mjs';
import { loadRoles } from '../compat/scopes.mjs';
import {
  authenticate,
  clearSessionCookieHeader,
  createOwner,
  createSession,
  hasOwner,
  revokeCurrentSession,
} from '../auth.mjs';

export function authRoutes({ logger }) {
  return [
    {
      method: 'GET',
      path: '/rest/login',
      public: true,
      handler: (ctx) => {
        if (!ctx.user) throw unauthorized();
        sendData(ctx.res, publicUser(ctx.user, ctx.config));
      },
    },
    {
      method: 'POST',
      path: '/rest/login',
      public: true,
      handler: (ctx) => {
        const { email, emailOrLdapLoginId, password } = ctx.body ?? {};
        const login = email ?? emailOrLdapLoginId;
        if (!login || !password) throw badRequest('Email and password are required');
        const user = authenticate(ctx.store, login, password);
        if (!user) throw unauthorized();
        // P5.2: a fresh login gets a fresh session AND a fresh CSRF token. The
        // token is bound to the session id, so re-using the old one against the
        // new session must fail — see issueToken/session binding in csrf.mjs.
        const { cookie, csrfCookie } = createSession(user, ctx.config);
        sendData(ctx.res, publicUser(user, ctx.config), {
          headers: { 'set-cookie': [cookie, csrfCookie] },
        });
      },
    },
    {
      method: 'POST',
      path: '/rest/logout',
      public: true,
      handler: (ctx) => {
        // P5.2: logout now kills the server-side session, not just the cookie.
        // Clearing the cookie alone only stopped *this* browser from presenting
        // the token — any copy of it stayed valid until it expired.
        revokeCurrentSession(ctx.config, ctx.req);
        sendData(ctx.res, { loggedOut: true }, { headers: { 'set-cookie': clearSessionCookieHeader() } });
      },
    },
    {
      method: 'POST',
      path: '/rest/owner/setup',
      public: true,
      handler: (ctx) => {
        if (hasOwner(ctx.store)) throw forbidden('Instance owner already exists');
        const { email, firstName, lastName, password } = ctx.body ?? {};
        if (!email || !password) throw badRequest('Email and password are required');
        const user = createOwner(ctx.store, { email, firstName, lastName, password });
        const { cookie, csrfCookie } = createSession(user, ctx.config);
        logger.info('owner account created', { email: user.email });
        sendData(ctx.res, publicUser(user, ctx.config), {
          headers: { 'set-cookie': [cookie, csrfCookie] },
        });
      },
    },
    {
      method: 'POST',
      path: '/rest/owner/dismiss-banner',
      handler: (ctx) => {
        sendData(ctx.res, true);
      },
    },

    /* ------------------------------------------------------------------- me */
    {
      method: ['GET', 'PATCH'],
      path: '/rest/me',
      handler: (ctx) => {
        const user = requireUser(ctx);
        if (ctx.method === 'PATCH') {
          const patch = {};
          for (const key of ['firstName', 'lastName', 'email']) {
            if (typeof ctx.body?.[key] === 'string') patch[key] = ctx.body[key];
          }
          if (typeof patch.email === 'string') patch.email = patch.email.toLowerCase();
          const updated = ctx.store.users.update(user.id, patch);
          // Upstream `me.controller.updateCurrentUser` returns `toPublic(user)`
          // without scopes — the editor merges it into its current user, while
          // the RBAC store keeps the scopes it was seeded with at login.
          return sendData(ctx.res, publicUser(updated, ctx.config, { withScopes: false }));
        }
        return sendData(ctx.res, publicUser(user, ctx.config));
      },
    },
    {
      method: 'PATCH',
      path: '/rest/me/settings',
      handler: (ctx) => {
        const user = requireUser(ctx);
        const updated = ctx.store.users.update(user.id, { settings: { ...(user.settings ?? {}), ...(ctx.body ?? {}) } });
        sendData(ctx.res, publicUser(updated, ctx.config, { withScopes: false }));
      },
    },
    {
      // Upstream `users.controller.listUsers` serializes without scopes; the
      // RBAC store only tracks the signed-in user's scopes.
      method: 'GET',
      path: '/rest/users',
      handler: (ctx) => {
        requireUser(ctx);
        const users = ctx.store.users.all().map((user) => publicUser(user, ctx.config, { withScopes: false }));
        sendData(ctx.res, { count: users.length, items: users });
      },
    },

    /* ----------------------------------------------------------------- roles */
    {
      method: 'GET',
      path: '/rest/roles',
      handler: (ctx) => {
        requireUser(ctx);
        sendData(ctx.res, loadRoles(ctx.config));
      },
    },
    {
      method: 'GET',
      path: '/rest/roles/:slug',
      handler: (ctx) => {
        requireUser(ctx);
        const roles = loadRoles(ctx.config);
        const all = [...roles.global, ...roles.project, ...roles.credential, ...roles.workflow];
        const role = all.find((candidate) => candidate.slug === ctx.params.slug);
        if (!role) throw notFound('Role not found');
        sendData(ctx.res, { ...role, usedByUsers: 1 });
      },
    },
  ];
}
