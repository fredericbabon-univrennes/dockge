/**
 * NGINX Configuration Parsing Utilities
 * Simplified - no presets, just utilities to extract info from existing configs
 */

/**
 * Get default path prefix for new stacks
 */
export function getDefaultPathPrefix(): string {
    return "/";
}

/**
 * Extract path prefix from Nginx config content
 * Looks for "location /path" directive
 */
export function extractPathPrefixFromNginxConfig(configContent: string): string {
    try {
        // Look for: location /path_prefix
        const match = configContent.match(/location\s+(\/[^\s]*)/);
        if (match && match[1]) {
            return match[1];
        }
    } catch (e) {
        // Ignore parse errors
    }
    return "/";
}

/**
 * Extract port from Nginx config content
 * Looks for "proxy_pass http://localhost:port"
 */
export function extractPortFromNginxConfig(configContent: string): number | null {
    try {
        // Look for: proxy_pass http://localhost:PORT or proxy_pass http://127.0.0.1:PORT
        const match = configContent.match(/proxy_pass\s+https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
        if (match && match[1]) {
            return parseInt(match[1]);
        }
    } catch (e) {
        // Ignore parse errors
    }
    return null;
}

/**
 * Extract FQDN from Nginx config content
 * Looks for "server_name" directive
 */
export function extractFqdnFromNginxConfig(configContent: string): string | null {
    try {
        const match = configContent.match(/server_name\s+([^\s;]+)/);
        if (match && match[1]) {
            return match[1];
        }
    } catch (e) {
        // Ignore parse errors
    }
    return null;
}

export interface NginxStackConfig {
    stackName: string;
    port: number | null;
    pathPrefix: string;
    fqdn: string | null;
}

