/**
 * NGINX Configuration Manager
 * Orchestrates creation, update, and deletion of Nginx configurations
 * Handles filesystem operations and Nginx service restarts
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import yaml from "yaml";
import { Stack } from "./stack";
import { DockgeServer } from "./dockge-server";
import { log } from "./log";
import { NginxGenerator, NginxGeneratedConfigs } from "./nginx-generator";
import { getDefaultPathPrefix } from "./nginx-config-parser";

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
                customPathPrefix,
                stack.composeYAML
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
            // preSsl (port 80) is just for ACME challenges, no proxy_pass needed
            const preValidation = this.generator.validateConfig(nginxConfigs.preSsl, false);
            // postSsl (port 443) must have proxy_pass
            const postValidation = this.generator.validateConfig(nginxConfigs.postSsl, true);

            if (!preValidation.valid || !postValidation.valid) {
                const errors = [...preValidation.errors, ...postValidation.errors];
                log.error("nginx-manager", `❌ Validation details:\n${JSON.stringify({ preSsl: preValidation, postSsl: postValidation }, null, 2)}`);
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

            // ========== 8. UPDATE CACHE ==========
            this.server.nginxConfigCache[stack.name] = {
                stackName: stack.name,
                port: stackInfo.port,
                pathPrefix: stackInfo.pathPrefix,
                fqdn: stackInfo.fqdn
            };
            log.info("nginx-manager", `📦 Cache updated for: ${stack.name}`);

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

            // ========== 5. UPDATE CACHE ==========
            delete this.server.nginxConfigCache[stackName];
            log.info("nginx-manager", `📦 Cache cleared for: ${stackName}`);

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
        customPathPrefix?: string,
        composeYAML?: string
    ): StackNginxInfo {
        const stackNameLower = stackName.toLowerCase();
        
        log.debug("nginx-manager", `📊 Preparing stack info for: ${stackName}`);
        log.debug("nginx-manager", `   customPort=${customPort}, customPathPrefix=${customPathPrefix}, hasCompose=${!!composeYAML}`);
        
        // Port priority: custom > compose-extracted > default
        const composeParsedPort = this.extractPortFromComposeYAML(composeYAML);
        log.debug("nginx-manager", `   Port priority: custom=${customPort} > compose=${composeParsedPort} > default=${this.server.nginxDefaultPort}`);
        
        const port = customPort || composeParsedPort || this.server.nginxDefaultPort;
        log.debug("nginx-manager", `   ✅ Final port: ${port}`);
        
        // Path prefix: custom > default
        const pathPrefix = customPathPrefix || getDefaultPathPrefix();
        log.debug("nginx-manager", `   ✅ Final pathPrefix: ${pathPrefix}`);

        // Generate FQDN with IP-dashed format if public IP is available
        let fqdn: string;
        if (this.server.nginxPublicIp) {
            const generator = new NginxGenerator();
            const ipDashed = generator.formatIpForDomain(this.server.nginxPublicIp);
            fqdn = `${stackNameLower}.${ipDashed}.${this.server.nginxDomainSuffix}`;
            log.debug("nginx-manager", `   📍 Public IP detected: using ${ipDashed}`);
        } else {
            fqdn = `${stackNameLower}.${this.server.nginxDomainSuffix}`;
            log.warn("nginx-manager", `   ⚠️  No public IP available, FQDN without IP: ${fqdn}`);
        }
        log.debug("nginx-manager", `   ✅ FQDN: ${fqdn}`);

        return {
            name: stackName,
            port,
            pathPrefix,
            fqdn
        };
    }

    /**
     * Extract port from compose YAML content
     * Handles formats like "8001:8000" (host:container) or just "8001"
     */
    private extractPortFromComposeYAML(composeYAML?: string): number | null {
        if (!composeYAML) {
            log.debug("nginx-manager", `📭 No compose YAML provided`);
            return null;
        }

        try {
            log.debug("nginx-manager", `📋 Parsing compose YAML (${composeYAML.length} chars)...`);
            const composeData = yaml.parse(composeYAML);
            
            if (!composeData.services) {
                log.warn("nginx-manager", `⚠️  No 'services' key in compose YAML`);
                return null;
            }

            log.debug("nginx-manager", `📦 Found services: [${Object.keys(composeData.services).join(", ")}]`);

            // Iterate through all services to find ports
            for (const [serviceName, service] of Object.entries(composeData.services) as [string, any][]) {
                log.debug("nginx-manager", `   Checking service: ${serviceName}`);
                
                if (service.ports && Array.isArray(service.ports)) {
                    log.debug("nginx-manager", `   Found ${service.ports.length} port(s)`);
                    
                    // Find the first exposed port
                    for (const portSpec of service.ports) {
                        log.debug("nginx-manager", `     Port spec: ${JSON.stringify(portSpec)} (type: ${typeof portSpec})`);
                        
                        if (typeof portSpec === 'string') {
                            // Format: "8001:8000" or "8001"
                            const parts = portSpec.split(':');
                            const hostPort = parseInt(parts[0]);
                            if (!isNaN(hostPort)) {
                                log.info("nginx-manager", `✅ Extracted port from compose: ${hostPort} from "${portSpec}"`);
                                return hostPort;
                            }
                        } else if (typeof portSpec === 'number') {
                            log.info("nginx-manager", `✅ Extracted port from compose: ${portSpec}`);
                            return portSpec;
                        }
                    }
                } else {
                    log.debug("nginx-manager", `   No ports in service ${serviceName}`);
                }
            }

            log.warn("nginx-manager", `⚠️  No ports found in any service, using default`);
            return null;
        } catch (e) {
            log.error("nginx-manager", `❌ YAML parse error: ${e instanceof Error ? e.message : String(e)}`);
            return null;
        }
    }
}
