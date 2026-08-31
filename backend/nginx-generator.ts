/**
 * NGINX Configuration Generator
 * Generates pre-SSL (port 80) and post-SSL (port 443) Nginx configurations
 */

import { log } from "./log";
import http from "http";
import https from "https";

export interface UrlPortMapping {
    url: string;
    fqdn: string;
    containerPort: number;
    pathPrefix?: string;
}

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
     * @param dockgeToken - Optional token for Dockge authentication
     * @param extraUrlMappings - Additional FQDN:port URL mappings for extra server blocks
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
        dockgeToken?: string,
        extraUrlMappings?: UrlPortMapping[]
    ): NginxGeneratedConfigs {
        const effectivePort = port || 8080;
        const effectivePathPrefix = pathPrefix || "/";
        const primaryFqdn = fqdn || stackName;

        console.log(`[NGINX-GENERATOR] Generating configs: stack=${stackName}, port=${effectivePort}, path=${effectivePathPrefix}`);
        if (extraUrlMappings && extraUrlMappings.length > 0) {
            console.log(`[NGINX-GENERATOR] Extra URL mappings: ${JSON.stringify(extraUrlMappings.map(m => (
                { fqdn: m.fqdn, containerPort: m.containerPort }
            )))}`);
        }

        // Generate the pre-SSL block with ALL FQDNs listed (wildcard can cover all subdomains)
        const preSsl = this.generatePreSslConfigs(primaryFqdn, acmeDir);

        // Primary server block
        const postSsl = this.generatePostSslConfig(
            stackName,
            primaryFqdn,
            effectivePort,
            effectivePathPrefix,
            sslCert,
            sslKey,            
            stackName === "dockge",
            dockgeToken
        );

        // Extra server blocks for URL mappings (exclude the primary FQDN to avoid duplicates)
        const filteredMappings = extraUrlMappings?.filter(m => m.fqdn !== primaryFqdn) || [];
        console.log(`[NGINX-GENERATOR] Filtered extra mappings (excluding primary FQDN ${primaryFqdn}): ${JSON.stringify(filteredMappings.map(m => (
            { fqdn: m.fqdn, containerPort: m.containerPort }
        )))}`);
        const extraBlocks = this.generateExtraServerBlocks(
            filteredMappings,            
            sslCert,
            sslKey
        );

        return {
            preSsl,
            postSsl: postSsl + extraBlocks
        };
    }

    /**
     * Generate pre-SSL configurations (port 80) for all FQDNs
     * Each FQDN gets its own server block for ACME challenges and HTTPS redirect
     */
    private generatePreSslConfigs(        
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
     * Generate post-SSL configuration (port 443) for a single FQDN
     */
    private generatePostSslConfig(
        stackName: string,
        fqdn: string,
        port: number,
        pathPrefix: string,
        sslCert: string,
        sslKey: string,        
        needsDockgeToken: boolean = false,
        dockgeToken?: string
    ): string {
        const locationPath = pathPrefix === "/" ? "/" : pathPrefix;
        const lines: string[] = [];

        lines.push("server {");
        lines.push("    listen 443 ssl;");
        lines.push(`    server_name ${fqdn};`);
        lines.push("");
        lines.push(`    ssl_certificate      ${sslCert};`);
        lines.push(`    ssl_certificate_key  ${sslKey};`);
        lines.push("");

        if (pathPrefix && pathPrefix !== "/") {
            lines.push("    location = / {");
            lines.push(`        return 302 https://$host${pathPrefix};`);
            lines.push("    }");
            lines.push("");
        }

        lines.push(`    location ${locationPath} {`);
        lines.push(`        proxy_pass http://127.0.0.1:${port};`);
        lines.push("        proxy_set_header Host $host;");
        lines.push("        proxy_set_header X-Real-IP $remote_addr;");
        lines.push("        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
        lines.push("        proxy_set_header X-Forwarded-Proto $scheme;");
        lines.push("        proxy_http_version 1.1;");
        lines.push("        proxy_set_header Upgrade $http_upgrade;");
        lines.push('        proxy_set_header Connection $http_connection;');
        lines.push("        proxy_buffering off;");
        lines.push("        proxy_read_timeout 86400;");
        lines.push("");

        if (needsDockgeToken && dockgeToken) {
            lines.push(`        proxy_set_header Cookie "token=${dockgeToken}";`);
        }

        lines.push("        include /etc/nginx/allowed_ips.conf;");
        lines.push("    }");
        lines.push("");

        if (stackName === "dockge") {
            lines.push("    location ~ ^/(assets|api|apple-touch-icon.png|icon.svg|favicon.ico) {");
            lines.push(`        proxy_pass http://127.0.0.1:${port};`);
            lines.push("        proxy_set_header Host $host;");
            lines.push("        proxy_set_header X-Real-IP $remote_addr;");
            lines.push("        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
            lines.push("        proxy_set_header X-Forwarded-Proto $scheme;");
            lines.push("        proxy_http_version 1.1;");
            lines.push("        proxy_set_header Upgrade $http_upgrade;");
            lines.push('        proxy_set_header Connection $http_connection;');
            lines.push("");

            if (dockgeToken) {
                lines.push(`        proxy_set_header Cookie "token=${dockgeToken}";`);
            }

            lines.push("        include /etc/nginx/allowed_ips.conf;");
            lines.push("    }");
            lines.push("");
        }

        lines.push("    client_max_body_size 0;");
        lines.push("}");
        return lines.join("\n");
    }

    /**
     * Generate extra HTTPS server blocks for URL:port mappings from x-dockge.urls
     */
    private generateExtraServerBlocks(        
        extraUrlMappings: UrlPortMapping[],        
        sslCert: string,
        sslKey: string        
    ): string {
        if (!extraUrlMappings || extraUrlMappings.length === 0) {
            return "";
        }

        let output = "\n";

        for (const mapping of extraUrlMappings) {
            const fqdn = mapping.fqdn;
            const containerPort = mapping.containerPort;
            const pathPrefix = mapping.pathPrefix || "/";

            log.info("nginx-generator", `Generating extra server block: ${fqdn} -> 127.0.0.1:${containerPort}`);

            // Generate post-SSL block for this extra FQDN
            output += this.generateExtraHttpsServerBlock(                
                fqdn,
                containerPort,
                pathPrefix,
                sslCert,
                sslKey               
            );
            output += "\n";
        }

        return output;
    }

    /**
     * Generate a single HTTPS server block for an extra URL:port mapping
     */
    private generateExtraHttpsServerBlock(        
        fqdn: string,
        containerPort: number,
        pathPrefix: string,
        sslCert: string,
        sslKey: string
    ): string {
        const locationPath = pathPrefix === "/" ? "/" : pathPrefix;
        const lines: string[] = [];

        lines.push("server {");
        lines.push("    listen 443 ssl;");
        lines.push(`    server_name ${fqdn};`);
        lines.push("");
        lines.push(`    ssl_certificate      ${sslCert};`);
        lines.push(`    ssl_certificate_key  ${sslKey};`);
        lines.push("");

        if (pathPrefix && pathPrefix !== "/") {
            lines.push("    location = / {");
            lines.push(`        return 302 https://$host${pathPrefix};`);
            lines.push("    }");
            lines.push("");
        }

        lines.push(`    location ${locationPath} {`);
        lines.push(`        proxy_pass http://127.0.0.1:${containerPort};`);
        lines.push("        proxy_set_header Host $host;");
        lines.push("        proxy_set_header X-Real-IP $remote_addr;");
        lines.push("        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
        lines.push("        proxy_set_header X-Forwarded-Proto $scheme;");
        lines.push("        proxy_http_version 1.1;");
        lines.push("        proxy_set_header Upgrade $http_upgrade;");
        lines.push('        proxy_set_header Connection $http_connection;');
        lines.push("        proxy_buffering off;");
        lines.push("        proxy_read_timeout 86400;");
        lines.push("");
        lines.push("        include /etc/nginx/allowed_ips.conf;");
        lines.push("    }");
        lines.push("");

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
