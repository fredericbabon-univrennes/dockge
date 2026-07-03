/**
 * NGINX Configuration Manager
 * Orchestrates creation, update, and deletion of Nginx configurations
 * Handles filesystem operations and Nginx service restarts
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { Stack } from "./stack";
import { DockgeServer } from "./dockge-server";
import { log } from "./log";
import { NginxGenerator, NginxGeneratedConfigs } from "./nginx-generator";
import { getPresetForService } from "./nginx-presets";

export interface StackNginxInfo {
    name: string;
    port: number;
    pathPrefix: string;
    fqdn: string;
}

export class NginxManager {
    private generator: NginxGenerator;
    private server: DockgeServer;

    constructor(server: DockgeServer) {
        this.server = server;
        this.generator = new NginxGenerator();
    }

    /**
     * Create or update Nginx configuration for a stack
     */
    async createOrUpdateNginxConfig(
        stack: Stack,
        isAdd: boolean,
        customPort?: number,
        customPathPrefix?: string
    ): Promise<void> {
        try {
            log.info("nginx-manager", `🔧 Processing Nginx for stack: ${stack.name}`);

            // ========== 1. PREPARE STACK INFO ==========
            const stackInfo = this.prepareStackInfo(
                stack.name,
                customPort,
                customPathPrefix
            );

            // ========== 2. GENERATE CONFIGS ==========
            const nginxConfigs = this.generator.generateConfigs(
                stack.name,
                stackInfo.port,
                stackInfo.pathPrefix,
                stackInfo.fqdn,
                this.server.nginxAcmeDir,
                this.server.nginxSslCert,
                this.server.nginxSslKey,
                this.server.nginxAllowedIps,
                process.env.DOCKGE_TOKEN
            );

            // ========== 3. VALIDATE CONFIGS ==========
            const preValidation = this.generator.validateConfig(nginxConfigs.preSsl);
            const postValidation = this.generator.validateConfig(nginxConfigs.postSsl);

            if (!preValidation.valid || !postValidation.valid) {
                const errors = [...preValidation.errors, ...postValidation.errors];
                throw new Error(`Config validation failed: ${errors.join(", ")}`);
            }

            log.info("nginx-manager", `✅ Config validation passed`);

            // ========== 4. SAVE LOCAL COPY (BACKUP) ==========
            const stackDir = path.join(this.server.stacksDir, stack.name);
            const localNginxPath = path.join(stackDir, "nginx.conf");

            if (!fs.existsSync(stackDir)) {
                fs.mkdirSync(stackDir, { recursive: true });
            }

            const fullConfig = nginxConfigs.preSsl + "\n\n" + nginxConfigs.postSsl;
            fs.writeFileSync(localNginxPath, fullConfig);

            log.info("nginx-manager", `💾 Local backup saved: ${localNginxPath}`);

            // ========== 5. SAVE TO PRODUCTION ==========
            const prodNginxPath = path.join(
                this.server.nginxConfigDir,
                stack.name
            );

            // Ensure Nginx config directory exists
            if (!fs.existsSync(this.server.nginxConfigDir)) {
                fs.mkdirSync(this.server.nginxConfigDir, { recursive: true });
                log.warn("nginx-manager", `📁 Created Nginx config directory: ${this.server.nginxConfigDir}`);
            }

            fs.writeFileSync(prodNginxPath, fullConfig);
            log.info("nginx-manager", `✅ Production config saved: ${prodNginxPath}`);

            // ========== 6. CREATE SYMLINK ==========
            const symlinkPath = path.join(
                this.server.nginxSymlinkDir,
                stack.name
            );

            if (!fs.existsSync(this.server.nginxSymlinkDir)) {
                fs.mkdirSync(this.server.nginxSymlinkDir, { recursive: true });
                log.warn("nginx-manager", `📁 Created Nginx symlink directory: ${this.server.nginxSymlinkDir}`);
            }

            // Remove old symlink if exists
            if (fs.existsSync(symlinkPath)) {
                fs.unlinkSync(symlinkPath);
                log.info("nginx-manager", `🔗 Removed old symlink: ${symlinkPath}`);
            }

            // Create new symlink
            fs.symlinkSync(prodNginxPath, symlinkPath);
            log.info("nginx-manager", `🔗 Symlink created: ${symlinkPath}`);

            // ========== 7. RESTART NGINX (optional) ==========
            if (this.server.nginxAutoRestart) {
                await this.restartNginx();
            } else {
                log.warn("nginx-manager", `⏸️  Auto-restart disabled. To apply: systemctl restart nginx`);
            }

        } catch (error: any) {
            log.error("nginx-manager", `❌ Error creating Nginx config: ${error.message}`);
            throw error;
        }
    }

    /**
     * Delete Nginx configuration for a stack
     */
    async deleteNginxConfig(stackName: string): Promise<void> {
        try {
            log.info("nginx-manager", `🗑️  Deleting Nginx config for: ${stackName}`);

            // ========== 1. REMOVE SYMLINK ==========
            const symlinkPath = path.join(
                this.server.nginxSymlinkDir,
                stackName
            );

            if (fs.existsSync(symlinkPath)) {
                fs.unlinkSync(symlinkPath);
                log.info("nginx-manager", `✅ Symlink deleted: ${symlinkPath}`);
            } else {
                log.warn("nginx-manager", `⚠️  Symlink not found: ${symlinkPath}`);
            }

            // ========== 2. REMOVE PRODUCTION CONFIG ==========
            const prodNginxPath = path.join(
                this.server.nginxConfigDir,
                stackName
            );

            if (fs.existsSync(prodNginxPath)) {
                fs.unlinkSync(prodNginxPath);
                log.info("nginx-manager", `✅ Production config deleted: ${prodNginxPath}`);
            } else {
                log.warn("nginx-manager", `⚠️  Production config not found: ${prodNginxPath}`);
            }

            // ========== 3. REMOVE LOCAL BACKUP ==========
            const stackDir = path.join(this.server.stacksDir, stackName);
            const localNginxPath = path.join(stackDir, "nginx.conf");

            if (fs.existsSync(localNginxPath)) {
                fs.unlinkSync(localNginxPath);
                log.info("nginx-manager", `✅ Local backup deleted: ${localNginxPath}`);
            }

            // ========== 4. RESTART NGINX ==========
            if (this.server.nginxAutoRestart) {
                await this.restartNginx();
            } else {
                log.warn("nginx-manager", `⏸️  Auto-restart disabled. To apply: systemctl restart nginx`);
            }

        } catch (error: any) {
            log.error("nginx-manager", `❌ Error deleting Nginx config: ${error.message}`);
            throw error;
        }
    }

    /**
     * Restart Nginx service
     */
    async restartNginx(): Promise<void> {
        try {
            log.info("nginx-manager", "🔄 Restarting Nginx...");

            // Test configuration first
            const testResult = this.testNginxConfig();
            if (!testResult.valid) {
                throw new Error(`Nginx config test failed: ${testResult.errors.join(", ")}`);
            }

            // Restart Nginx
            execSync("systemctl restart nginx", { stdio: "pipe" });
            log.info("nginx-manager", "✅ Nginx restarted successfully");

        } catch (error: any) {
            log.error("nginx-manager", `❌ Error restarting Nginx: ${error.message}`);
            throw error;
        }
    }

    /**
     * Test Nginx configuration syntax
     */
    private testNginxConfig(): { valid: boolean; errors: string[] } {
        try {
            execSync("nginx -t 2>&1", { stdio: "pipe" });
            return { valid: true, errors: [] };
        } catch (error: any) {
            return {
                valid: false,
                errors: [error.toString()]
            };
        }
    }

    /**
     * Synchronize Nginx configs with Dockge stacks
     * Detects orphaned configs and missing ones
     */
    async syncNginxWithDockge(): Promise<{
        synced: string[];
        deleted: string[];
        errors: string[];
    }> {
        const result = { synced: [], deleted: [], errors: [] };

        try {
            log.info("nginx-manager", "🔄 Syncing Nginx ↔ Dockge...");

            // ========== 1. GET STACKS IN DOCKGE ==========
            const stackList = await Stack.getStackList(this.server);
            const dockgeStackNames = new Set(stackList.keys());

            // ========== 2. GET NGINX CONFIGS IN PRODUCTION ==========
            if (!fs.existsSync(this.server.nginxConfigDir)) {
                log.warn("nginx-manager", `Nginx config dir not found: ${this.server.nginxConfigDir}`);
                return result;
            }

            const nginxConfigs = fs.readdirSync(this.server.nginxConfigDir)
                .filter(f => !f.startsWith("."));

            // ========== 3. DETECT ORPHANED CONFIGS ==========
            for (const nginxConfig of nginxConfigs) {
                if (!dockgeStackNames.has(nginxConfig)) {
                    log.warn("nginx-manager", `⚠️  Orphaned config found: ${nginxConfig}`);
                    result.deleted.push(nginxConfig);
                }
            }

            // ========== 4. CHECK FOR MISSING CONFIGS ==========
            for (const [stackName] of stackList) {
                const configPath = path.join(
                    this.server.nginxConfigDir,
                    stackName
                );
                if (!fs.existsSync(configPath)) {
                    log.warn("nginx-manager", `⚠️  Stack ${stackName} missing Nginx config`);
                    result.synced.push(stackName);
                }
            }

            log.info("nginx-manager", `✅ Sync complete: ${result.synced.length} synced, ${result.deleted.length} orphaned`);
            return result;

        } catch (error: any) {
            result.errors.push(error.message);
            log.error("nginx-manager", `❌ Error during sync: ${error.message}`);
            return result;
        }
    }

    /**
     * Prepare stack information for Nginx config generation
     */
    private prepareStackInfo(
        stackName: string,
        customPort?: number,
        customPathPrefix?: string
    ): StackNginxInfo {
        // Use custom values if provided, otherwise try preset
        let port = customPort || 8080;
        let pathPrefix = customPathPrefix || "/";

        const preset = getPresetForService(stackName);
        if (preset && !customPort) {
            port = preset.port;
        }
        if (preset && !customPathPrefix) {
            pathPrefix = preset.pathPrefix;
        }

        // Generate FQDN
        const fqdn = `${stackName}.${this.server.nginxDomainSuffix}`;

        return {
            name: stackName,
            port,
            pathPrefix,
            fqdn
        };
    }
}
