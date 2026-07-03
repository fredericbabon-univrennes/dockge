/**
 * NGINX Configuration Generator
 * Generates pre-SSL (port 80) and post-SSL (port 443) Nginx configurations
 */

import { log } from "./log";
import http from "http";
import https from "https";

export interface NginxGeneratedConfigs {
    preSsl: string;
    postSsl: string;
}

export class NginxGenerator {
    /**
     * Fetch the public IP address
     * Tries Google Cloud metadata first, then other methods
     */
    async getPublicIp(): Promise<string | null> {
        try {
            // Try Google Cloud metadata service
            return await this.getPublicIpFromGcp();
        } catch (e) {
            log.warn("nginx-generator", `Failed to get public IP from GCP: ${e.message}`);
        }

        return null;
    }

    /**
     * Fetch public IP from Google Cloud metadata service
     * Uses HTTP (not HTTPS) to avoid certificate verification issues
     */
    private getPublicIpFromGcp(): Promise<string> {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: "metadata.google.internal",
                path: "/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip",
                method: "GET",
                headers: {
                    "Metadata-Flavor": "Google"
                },
                timeout: 3000
            };

            http.request(options, (res) => {
                let data = "";
                res.on("data", chunk => data += chunk);
                res.on("end", () => {
                    const ip = data.trim();
                    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
                        resolve(ip);
                    } else {
                        reject(new Error("Invalid IP format"));
                    }
                });
            }).on("error", reject).end();
        });
    }

    /**
     * Format IP address with dashes for domain names
     * Example: "192.168.1.1" -> "192-168-1-1"
     */
    formatIpForDomain(ip: string): string {
        return ip.replace(/\./g, "-");
    }
    /**
     * Generate both pre-SSL and post-SSL configurations
     * @param stackName - Name of the stack
     * @param port - Service port (defaults to 8080)
     * @param pathPrefix - URL path prefix (defaults to "/")
     * @param fqdn - Fully qualified domain name (e.g., jupyter.192-168-1-1.sslip.io)
     * @param acmeDir - ACME challenge directory
     * @param sslCert - Path to SSL certificate
     * @param sslKey - Path to SSL key
     * @param allowedIps - Array of allowed IP addresses
     * @param dockgeToken - Optional token for Dockge authentication
     * @returns Generated configurations
     */
    generateConfigs(
        stackName: string,
        port?: number,
        pathPrefix?: string,
        fqdn?: string,
        acmeDir: string = "/var/www/acme",
        sslCert: string = "/etc/nginx/ssl/wildcard.crt",
        sslKey: string = "/etc/nginx/ssl/wildcard.key",
        allowedIps: string[] = ["127.0.0.1"],
        dockgeToken?: string
    ): NginxGeneratedConfigs {
        // Use provided parameters directly (simplified approach without presets)
        const effectivePort = port || 8080;
        const effectivePathPrefix = pathPrefix || "/";

        console.log(`[NGINX-GENERATOR] 📝 Generating configs: stack=${stackName}, port=${effectivePort}, path=${effectivePathPrefix}`);

        return {
            preSsl: this.generatePreSslConfig(stackName, fqdn || stackName, acmeDir),
            postSsl: this.generatePostSslConfig(
                stackName,
                fqdn || stackName,
                effectivePort,
                effectivePathPrefix,
                sslCert,
                sslKey,
                allowedIps,
                stackName === "dockge",
                dockgeToken
            )
        };
    }

    /**
     * Generate pre-SSL configuration (port 80)
     * Handles ACME challenges and redirects to HTTPS
     */
    private generatePreSslConfig(
        stackName: string,
        fqdn: string,
        acmeDir: string
    ): string {
        const lines = [
            "server {",
            "    listen 80;",
            `    server_name ${fqdn};`,
            "",
            "    location /.well-known/acme-challenge/ {",
            `        root ${acmeDir};`,
            "    }",
            "",
            "    location / {",
            "        return 301 https://$host$request_uri;",
            "    }",
            "}"
        ];

        return lines.join("\n");
    }

    /**
     * Generate post-SSL configuration (port 443)
     * Main reverse proxy configuration with authentication and routing
     */
    private generatePostSslConfig(
        stackName: string,
        fqdn: string,
        port: number,
        pathPrefix: string,
        sslCert: string,
        sslKey: string,
        allowedIps: string[],
        needsDockgeToken: boolean = false,
        dockgeToken?: string
    ): string {
        const locationPath = pathPrefix === "/" ? "/" : pathPrefix;
        const lines: string[] = [];

        // ========== Port 443 HTTPS main server block ==========
        lines.push("server {");
        lines.push("    listen 443 ssl;");
        lines.push(`    server_name ${fqdn};`);
        lines.push("");
        lines.push(`    ssl_certificate      ${sslCert};`);
        lines.push(`    ssl_certificate_key  ${sslKey};`);
        lines.push("");

        // ========== Root redirect to path_prefix if necessary ==========
        if (pathPrefix && pathPrefix !== "/") {
            lines.push("    location = / {");
            lines.push(`        return 302 https://$host${pathPrefix};`);
            lines.push("    }");
            lines.push("");
        }

        // ========== Main proxy location ==========
        lines.push(`    location ${locationPath} {`);
        lines.push(`        proxy_pass http://127.0.0.1:${port};`);
        lines.push("        proxy_set_header Host $host;");
        lines.push("        proxy_set_header X-Real-IP $remote_addr;");
        lines.push("        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
        lines.push("        proxy_set_header X-Forwarded-Proto $scheme;");
        lines.push("        proxy_http_version 1.1;");
        lines.push("        proxy_set_header Upgrade $http_upgrade;");
        lines.push('        proxy_set_header Connection "upgrade";');
        lines.push("        proxy_read_timeout 86400;");
        lines.push("");

        // ========== Dockge token injection ==========
        if (needsDockgeToken && dockgeToken) {
            lines.push(`        proxy_set_header Cookie "token=${dockgeToken}";`);
        }

        // ========== IP access control ==========
        for (const ip of allowedIps) {
            lines.push(`        allow ${ip};`);
        }
        lines.push("        deny all;");
        lines.push("    }");
        lines.push("");

        // ========== Special routes for Dockge (assets, API, icons) ==========
        if (stackName === "dockge") {
            lines.push("    location ~ ^/(assets|api|apple-touch-icon.png|icon.svg|favicon.ico) {");
            lines.push(`        proxy_pass http://127.0.0.1:${port};`);
            lines.push("        proxy_set_header Host $host;");
            lines.push("        proxy_set_header X-Real-IP $remote_addr;");
            lines.push("        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
            lines.push("        proxy_set_header X-Forwarded-Proto $scheme;");
            lines.push("        proxy_http_version 1.1;");
            lines.push("        proxy_set_header Upgrade $http_upgrade;");
            lines.push('        proxy_set_header Connection "upgrade";');
            lines.push("");

            if (dockgeToken) {
                lines.push(`        proxy_set_header Cookie "token=${dockgeToken}";`);
            }

            for (const ip of allowedIps) {
                lines.push(`        allow ${ip};`);
            }

            lines.push("        deny all;");
            lines.push("    }");
            lines.push("");
        }

        // ========== client_max_body_size for large uploads ==========
        lines.push("    client_max_body_size 0;");
        lines.push("}");
        return lines.join("\n");
    }

    /**
     * Validate generated Nginx configuration
     * Basic syntax checks
     */
    validateConfig(configContent: string, requireProxyPass: boolean = true): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!configContent) {
            errors.push("Configuration is empty");
            return { valid: false, errors };
        }

        if (!configContent.includes("server {")) {
            errors.push("Missing 'server {' block");
        }

        if (!configContent.includes("listen ")) {
            errors.push("Missing 'listen' directive");
        }

        if (!configContent.includes("server_name ")) {
            errors.push("Missing 'server_name' directive");
        }

        // Only check for proxy_pass if this is a service config (postSsl)
        // preSsl is just for ACME and redirects, doesn't need proxy_pass
        if (requireProxyPass && configContent.includes("location") && !configContent.includes("proxy_pass ")) {
            errors.push("Missing 'proxy_pass' directive - no valid proxy location found");
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Extract port from Docker Compose YAML
     * Looks for ports in services
     */
    extractPortFromCompose(composeYaml: string): number | null {
        try {
            // Simple regex to find port mappings
            // Looks for patterns like "8890:8888" or just "8890"
            const portMatch = composeYaml.match(/ports:\s*\n\s*-\s*['"]?(\d+):/);
            if (portMatch && portMatch[1]) {
                return parseInt(portMatch[1], 10);
            }
        } catch (e) {
            log.warn("nginx-generator", `Failed to extract port from compose YAML: ${e.message}`);
        }
        return null;
    }
}
