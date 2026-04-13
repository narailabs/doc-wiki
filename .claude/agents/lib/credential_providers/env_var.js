export class EnvVarProvider {
    _prefix;
    constructor(opts = {}) {
        this._prefix = opts.prefix ?? "";
    }
    async getSecret(name) {
        return this.getSecretSync(name);
    }
    getSecretSync(name) {
        const literal = process.env[name];
        if (literal !== undefined && literal !== "")
            return literal;
        const normalized = this._prefix + _normalize(name);
        const value = process.env[normalized];
        if (value !== undefined && value !== "")
            return value;
        return null;
    }
}
function _normalize(name) {
    return name
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
}
