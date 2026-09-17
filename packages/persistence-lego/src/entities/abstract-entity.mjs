/**
 * 1:1 port of the VALUE layer of n8n db package: entities/abstract-entity.ts
 *
 * Scope note: the ORM decorators (`Column`, `BeforeInsert`, `CreateDateColumn`,
 * `UpdateDateColumn`, `PrimaryColumn`) attach metadata consumed by the ORM driver —
 * out of scope for this DB-free increment (contract §12.2). What IS wire-visible and
 * therefore ported faithfully here:
 *   - the dialect-dependent column TYPE resolution (json/datetime/binary/timestamp syntax),
 *   - the exact column option objects (precision: 3, default: () => timestampSyntax),
 *   - the lifecycle-hook value semantics (`generateId` sets id only when falsy;
 *     `setUpdateDate` replaces updatedAt with a fresh Date),
 *   - the mixin composition order:
 *       WithStringId = mixinStringId(Base)
 *       WithCreatedAt = mixinCreatedAt(Base)
 *       WithUpdatedAt = mixinUpdatedAt(Base)
 *       WithTimestamps = mixinCreatedAt(mixinUpdatedAt(Base))
 *       WithTimestampsAndStringId = mixinStringId(WithTimestamps)
 *
 * Deviation D-PERSIST-03: `dbType` is resolved from port P-PERSIST-CONFIG explicitly
 * per call (reference binds it once at module load via the DI Container). Behavior is
 * identical for any fixed config; the explicit parameter keeps the port hermetic.
 */
import { getDbType } from '../ports.mjs';
import { generateNanoId } from '../utils/generators.mjs';

const TIMESTAMP_SYNTAX = {
	sqlite: "STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')",
	postgresdb: 'CURRENT_TIMESTAMP(3)',
};

export function timestampSyntaxFor(dbType = getDbType()) {
	return TIMESTAMP_SYNTAX[dbType];
}

export function jsonColumnTypeFor(dbType = getDbType()) {
	return dbType === 'sqlite' ? 'simple-json' : 'json';
}

export function datetimeColumnTypeFor(dbType = getDbType()) {
	return dbType === 'postgresdb' ? 'timestamptz' : 'datetime';
}

const BINARY_COLUMN_TYPE_MAP = {
	sqlite: 'blob',
	postgresdb: 'bytea',
};

export function binaryColumnTypeFor(dbType = getDbType()) {
	return BINARY_COLUMN_TYPE_MAP[dbType];
}

/** Column({ ...options, type: jsonColumnType }) — options spread BEFORE type (type wins ties). */
export function jsonColumnOptions(options, dbType = getDbType()) {
	return {
		...options,
		type: jsonColumnTypeFor(dbType),
	};
}

/** Column({ ...options, type: datetimeColumnType }) */
export function dateTimeColumnOptions(options, dbType = getDbType()) {
	return {
		...options,
		type: datetimeColumnTypeFor(dbType),
	};
}

/** Column({ ...options, type: binaryColumnType }) */
export function binaryColumnOptions(options, dbType = getDbType()) {
	return {
		...options,
		type: binaryColumnTypeFor(dbType),
	};
}

/** Frozen reference column options for created/updated timestamps (precision 3). */
export function tsColumnOptionsFor(dbType = getDbType()) {
	return {
		precision: 3,
		default: () => timestampSyntaxFor(dbType),
		type: datetimeColumnTypeFor(dbType),
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mixinStringId(base = class {}) {
	class Derived extends base {
		// @PrimaryColumn('varchar') -> column spec: { id: { type: 'varchar', primary: true } }

		// @BeforeInsert()
		generateId() {
			if (!this.id) {
				this.id = generateNanoId();
			}
		}
	}
	return Derived;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mixinUpdatedAt(base = class {}) {
	class Derived extends base {
		// @UpdateDateColumn(tsColumnOptions)

		// @BeforeUpdate()
		setUpdateDate() {
			this.updatedAt = new Date();
		}
	}
	return Derived;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mixinCreatedAt(base = class {}) {
	class Derived extends base {
		// @CreateDateColumn(tsColumnOptions)
	}
	return Derived;
}

class BaseEntity {}

export const WithStringId = mixinStringId(BaseEntity);
export const WithCreatedAt = mixinCreatedAt(BaseEntity);
export const WithUpdatedAt = mixinUpdatedAt(BaseEntity);
export const WithTimestamps = mixinCreatedAt(mixinUpdatedAt(BaseEntity));
export const WithTimestampsAndStringId = mixinStringId(WithTimestamps);
