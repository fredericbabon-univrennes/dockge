/**
 * NGINX Config Loader
 * Loads and parses existing Nginx configurations from /etc/nginx/sites-available
 */

import fs from "fs";
import path from "path";
import { log } from "./log";
import { extractPathPrefixFromNginxConfig, extractPortFromNginxConfig, extractFqdnFromNginxConfig, NginxStackConfig } from "./nginx-presets";

export interface NginxConfigCache {
    [stackName: string]: NginxStackConfig;
}

/**
 * Load all existing Nginx configs from sites-available directory
 * Parse each config file to extract port, path_prefix, and FQDN
 */
export async function loadExistingNginxConfigs(nginxConfigDir: string): Promise<NginxConfigCache> {
    const cache: NginxConfigCache = {};

    try {
        // Check if directory exists
        if (!fs.existsSync(nginxConfigDir)) {
            log.warn("nginx-config-loader", `📁 Nginx config dir not found: ${nginxConfigDir}`);
            return cache;
        }

        // Read all files from sites-available
        const files = fs.readdirSync(nginxConfigDir);

        for (const filename of files) {
            const filePath = path.join(nginxConfigDir, filename);
            
            try {
                const stats = fs.statSync(filePath);
                if (!stats.isFile()) {
                    continue;
                }

                // Read config file
                const configContent = fs.readFileSync(filePath, "utf-8");

                // Extract information
                const port = extractPortFromNginxConfig(configContent);
                const pathPrefix = extractPathPrefixFromNginxConfig(configContent);
                const fqdn = extractFqdnFromNginxConfig(configContent);

                cache[filename] = {
                    stackName: filename,
                    port,
                    pathPrefix,
                    fqdn,
                };

                log.info("nginx-config-loader", `✅ Loaded config for stack: ${filename} (port=${port}, path=${pathPrefix}, fqdn=${fqdn})`);
            } catch (e) {
                log.warn("nginx-config-loader", `⚠️  Failed to parse config ${filename}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        log.info("nginx-config-loader", `✅ Loaded ${Object.keys(cache).length} Nginx config(s)`);
        return cache;

    } catch (e) {
        log.error("nginx-config-loader", `❌ Error loading Nginx configs: ${e instanceof Error ? e.message : String(e)}`);
        return cache;
    }
}
