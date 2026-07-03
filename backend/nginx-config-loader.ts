/**
 * NGINX Config Loader
 * Loads and parses existing Nginx configurations from /etc/nginx/sites-available
 */

import fs from "fs";
import path from "path";
import { log } from "./log";
import { extractPathPrefixFromNginxConfig, extractPortFromNginxConfig, extractFqdnFromNginxConfig, NginxStackConfig } from "./nginx-config-parser";

export interface NginxConfigCache {
    [stackName: string]: NginxStackConfig;
}

/**
 * Load all existing Nginx configs from sites-available directory
 * Parse each config file to extract port, path_prefix, and FQDN
 */
export async function loadExistingNginxConfigs(nginxConfigDir: string): Promise<NginxConfigCache> {
    const cache: NginxConfigCache = {};

    log.debug("nginx-config-loader", `📂 Starting config loader for directory: ${nginxConfigDir}`);

    try {
        // Check if directory exists
        if (!fs.existsSync(nginxConfigDir)) {
            log.warn("nginx-config-loader", `📁 Nginx config dir NOT FOUND: ${nginxConfigDir}`);
            log.info("nginx-config-loader", `💡 Make sure to mount the Nginx config directory or configure nginxConfigDir setting`);
            return cache;
        }

        log.debug("nginx-config-loader", `✅ Directory exists: ${nginxConfigDir}`);

        // Read all files from sites-available
        const files = fs.readdirSync(nginxConfigDir);
        log.info("nginx-config-loader", `📋 Found ${files.length} file(s) in config directory: [${files.join(", ")}]`);

        for (const filename of files) {
            const filePath = path.join(nginxConfigDir, filename);
            
            try {
                const stats = fs.statSync(filePath);
                if (!stats.isFile()) {
                    log.debug("nginx-config-loader", `⏭️  Skipping non-file: ${filename}`);
                    continue;
                }

                log.debug("nginx-config-loader", `📖 Reading config file: ${filename}`);
                const configContent = fs.readFileSync(filePath, "utf-8");
                log.debug("nginx-config-loader", `   Config size: ${configContent.length} bytes`);

                // Extract information
                const port = extractPortFromNginxConfig(configContent);
                const pathPrefix = extractPathPrefixFromNginxConfig(configContent);
                const fqdn = extractFqdnFromNginxConfig(configContent);

                log.debug("nginx-config-loader", `   Extracted: port=${port}, path=${pathPrefix}, fqdn=${fqdn}`);

                cache[filename] = {
                    stackName: filename,
                    port,
                    pathPrefix,
                    fqdn,
                };

                log.info("nginx-config-loader", `✅ ${filename}: port=${port}, path=${pathPrefix}, fqdn=${fqdn}`);
            } catch (e) {
                log.warn("nginx-config-loader", `❌ Failed to parse ${filename}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        log.info("nginx-config-loader", `🎉 Loaded ${Object.keys(cache).length} config(s)`);
        return cache;

    } catch (e) {
        log.error("nginx-config-loader", `💥 Error reading directory ${nginxConfigDir}: ${e instanceof Error ? e.message : String(e)}`);
        return cache;
    }
}
