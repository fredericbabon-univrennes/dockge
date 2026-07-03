/**
 * NGINX Configuration Parsing Utilities
 * Extracts configuration data from existing Nginx configs
 */

/**
 * Get default path prefix for new stacks
 */
export function getDefaultPathPrefix(): string {
    return "/";
}

/**
 * Extract path prefix from Nginx config content
 * Looks for the location directive that contains proxy_pass (not acme or redirects)
 */
export function extractPathPrefixFromNginxConfig(configContent: string): string {
    try {
        // Find location blocks that contain proxy_pass (the actual proxy configuration)
        // Use regex to match: location ... { ... proxy_pass ... }
        const blockRegex = /location\s+([^\s{]+)\s*\{[^}]*proxy_pass[^}]*\}/gs;
        const blocks = configContent.match(blockRegex);

        if (blocks && blocks.length > 0) {
            // Extract the path from the matching location block
            // Usually there's only one, but if multiple, take the last one
            const lastMatch = blocks[blocks.length - 1].match(/location\s+([^\s{]+)/);
            if (lastMatch && lastMatch[1]) {
                return lastMatch[1];
            }
        } else {
            // No proxy_pass found, log for debugging
        }
    } catch (e) {
        // Ignore parse errors
    }
    return "/";
}

/**
 * Extract port from Nginx config content
 * Looks for "proxy_pass http://localhost:port" or "proxy_pass http://IP:port"
 */
export function extractPortFromNginxConfig(configContent: string): number | null {
    try {
        // Look for: proxy_pass http://localhost:PORT or proxy_pass http://127.0.0.1:PORT or http://[any-IP]:PORT
        // Try exact localhost/127.0.0.1 first (most specific)
        let match = configContent.match(/proxy_pass\s+https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
        if (match && match[1]) {
            return parseInt(match[1]);
        }
        
        // Fallback to any IP:PORT pattern
        match = configContent.match(/proxy_pass\s+https?:\/\/[0-9a-zA-Z.-]+:(\d+)/);
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
 * Looks for "server_name" directive in the SSL (443) block preferentially
 */
export function extractFqdnFromNginxConfig(configContent: string): string | null {
    try {
        // Try to find server_name in an SSL block first (port 443)
        // Look for: listen 443 ... and then server_name
        const sslBlockMatch = configContent.match(/listen\s+443[^}]*server_name\s+([^\s;]+)/s);
        if (sslBlockMatch && sslBlockMatch[1]) {
            return sslBlockMatch[1];
        }

        // Fallback: get first server_name
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
