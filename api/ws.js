import { createGameServer } from '../server.js'

// Vercel routes both the public rewrite and direct function URL to this server.
export default createGameServer({ socketPath: null })
