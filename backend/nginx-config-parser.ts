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
 * Uses line-by-line parsing to reliably identify location blocks with proxy_pass
 */
export function extractPathPrefixFromNginxConfig(configContent: string): string {
    try {
        const lines = configContent.split('\n');
        let lastValidPath = "/";
        let inLocationBlock = false;
        let currentLocationPath = '';
        let blockHasProxyPass = false;

        for (const line of lines) {
            const trimmed = line.trim();

            // Detect location directive start
            if (trimmed.startsWith('location')) {
                // Save previous block if it had proxy_pass
                if (inLocationBlock && blockHasProxyPass && currentLocationPath) {
                    const pathValue = currentLocationPath.trim();
                    // Skip special location patterns (=, ~, ~*) - these are not URL prefixes
                    if (pathValue !== '=' && !pathValue.startsWith('~')) {
                        lastValidPath = pathValue;
                    }
                }

                // Extract new location path from this line
                const match = trimmed.match(/location\s+([^\s{]+)/);
                if (match && match[1]) {
                    currentLocationPath = match[1];
                    inLocationBlock = true;
                    blockHasProxyPass = false;
                }
            }

            // Detect proxy_pass directive within location block
            if (inLocationBlock && trimmed.startsWith('proxy_pass')) {
                blockHasProxyPass = true;
            }

            // Detect block end
            if (inLocationBlock && trimmed === '}') {
                if (blockHasProxyPass && currentLocationPath) {
                    const pathValue = currentLocationPath.trim();
                    // Skip special location patterns (=, ~, ~*) - these are not URL prefixes
                    if (pathValue !== '=' && !pathValue.startsWith('~')) {
                        lastValidPath = pathValue;
                    }
                }
                inLocationBlock = false;
                currentLocationPath = '';
                blockHasProxyPass = false;
            }
        }

        return lastValidPath;
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

/**
 * Extract allowed IPs from Nginx config content
 * Looks for "allow <IP>" directives (legacy format with inline allow/deny rules)
 * Note: New configs use "include /etc/nginx/allowed_ips.conf;" for centralized IP management
 */
export function extractAllowedIpsFromNginxConfig(configContent: string): string[] {
    try {
        // Try to find allow directives (legacy format with inline allow/deny rules)
        const allowRegex = /allow\s+([0-9a-zA-Z.:]+)\s*;/g;
        const ips: Set<string> = new Set();
        let match;

        while ((match = allowRegex.exec(configContent)) !== null) {
            const ip = match[1].trim();
            if (ip && ip !== "all") {
                ips.add(ip);
            }
        }

        // Return found IPs
        if (ips.size > 0) {
            return Array.from(ips);
        }

        // If no allow directives found, return default
        // (whether config uses legacy allow/deny or new include directive, default to 127.0.0.1)
        return ["127.0.0.1"];
    } catch (e) {
        // Ignore parse errors
    }
    return ["127.0.0.1"];  // Default fallback
}

export interface NginxStackConfig {
    stackName: string;
    port: number | null;
    pathPrefix: string;
    fqdn: string | null;
}
