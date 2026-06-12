/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module — keep it out of the server bundle so the
  // compiled .node binary is loaded directly at runtime.
  serverExternalPackages: ["better-sqlite3", "ewelink-api"],
};

export default nextConfig;
