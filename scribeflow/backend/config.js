// Auth is controlled entirely by the AUTH_ENABLED environment variable.
// Set AUTH_ENABLED=true in docker-compose.yml to enable multi-user mode.
// This file is kept for any future runtime configuration needs.

const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';

module.exports = { AUTH_ENABLED };
