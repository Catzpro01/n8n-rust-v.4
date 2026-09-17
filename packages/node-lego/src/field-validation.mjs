/** Dependency-free reconstruction of the `validateFieldType` surface used by parameter issues. */

const description = (value) => {
	if (typeof value === 'object') return value === null ? "'null'" : Array.isArray(value) ? 'array' : 'object';
	return `'${String(value)}'`;
};

const parseBoolean = (value) => {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase())) return value.toLowerCase() === 'true';
	if (!(typeof value === 'string' && value.trim() === '')) {
		const number = Number(value);
		if (number === 0) return false;
		if (number === 1) return true;
	}
	throw new Error('invalid boolean');
};

const parseArray = (value) => {
	if (Array.isArray(value)) return value;
	let parsed;
	try { parsed = JSON.parse(String(value)); } catch { parsed = JSON.parse(String(value).replace(/'/g, '"')); }
	if (!Array.isArray(parsed)) throw new Error('invalid array');
	return parsed;
};

const parseObject = (value) => {
	if (value && typeof value === 'object' && !Array.isArray(value)) return value;
	const parsed = JSON.parse(String(value));
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid object');
	return parsed;
};

export function validateFieldType(fieldName, value, type, options = {}) {
	if (value === null || value === undefined) return { valid: true };
	const strict = options.strict ?? false;
	const valueOptions = options.valueOptions ?? [];
	const parseStrings = options.parseStrings ?? false;
	const expected = `'${fieldName}' expects a ${type} but we got ${description(value)}`;
	try {
		switch (type.toLowerCase()) {
			case 'string':
				if (!parseStrings) return { valid: true, newValue: value };
				if (strict && typeof value !== 'string') throw new Error();
				return { valid: true, newValue: typeof value === 'object' ? JSON.stringify(value) : value === undefined ? '' : String(value) };
			case 'string-alphanumeric':
				if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(value))) return { valid: false, errorMessage: 'Value is not a valid alphanumeric string, only letters, numbers and underscore allowed' };
				return { valid: true, newValue: String(value) };
			case 'number': {
				if ((strict && typeof value !== 'number') || Number.isNaN(Number(value))) throw new Error();
				return { valid: true, newValue: Number(value) };
			}
			case 'boolean':
				if (strict && typeof value !== 'boolean') throw new Error();
				return { valid: true, newValue: parseBoolean(value) };
			case 'datetime':
				if (value instanceof Date ? Number.isNaN(value.valueOf()) : Number.isNaN(Date.parse(String(value).trim()))) {
					return { valid: false, errorMessage: `${expected} <br/><br/> Consider using <a href="https://moment.github.io/luxon/api-docs/index.html#datetimefromformat" target="_blank"><code>DateTime.fromFormat</code></a> to work with custom date formats.` };
				}
				return { valid: true, newValue: value };
			case 'time':
				if (!/^\d{2}:\d{2}(:\d{2})?((-|\+)\d{4})?((-|\+)\d{1,2}(:\d{2})?)?$/s.test(String(value))) return { valid: false, errorMessage: `'${fieldName}' expects time (hh:mm:(:ss)) but we got ${description(value)}.` };
				return { valid: true, newValue: String(value) };
			case 'object':
				if (strict && (!value || typeof value !== 'object')) throw new Error();
				return { valid: true, newValue: parseObject(value) };
			case 'array':
				if (strict && !Array.isArray(value)) throw new Error();
				return { valid: true, newValue: parseArray(value) };
			case 'options': {
				const validOptions = valueOptions.map((option) => option.value);
				return validOptions.includes(value)
					? { valid: true, newValue: value }
					: { valid: false, errorMessage: `'${fieldName}' expects one of the following values: [${validOptions.join(', ')}] but we got ${description(value)}` };
			}
			case 'url': {
				const candidate = typeof value === 'string' && !value.includes('://') ? `https://${value}` : String(value);
				const parsed = new URL(candidate);
				if (!['http:', 'https:', 'ftp:', 'file:'].includes(parsed.protocol)) throw new Error();
				return { valid: true, newValue: value };
			}
			case 'jwt':
				return value && /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*$/.test(String(value))
					? { valid: true, newValue: String(value) }
					: { valid: false, errorMessage: 'Value is not a valid JWT token' };
			default: return { valid: true, newValue: value };
		}
	} catch {
		return { valid: false, errorMessage: expected };
	}
}
