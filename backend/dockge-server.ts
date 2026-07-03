import "dotenv/config";
import { MainRouter } from "./routers/main-router";
import * as fs from "node:fs";
import { PackageJson } from "type-fest";
import { Database } from "./database";
import packageJSON from "../package.json";
import { log } from "./log";
import * as socketIO from "socket.io";
import express, { Express } from "express";
import jwt from "jsonwebtoken";
import { parse } from "ts-command-line-args";
import https from "https";
import http from "http";
import { Router } from "./router";
import { Socket } from "socket.io";
import { MainSocketHandler } from "./socket-handlers/main-socket-handler";
import { SocketHandler } from "./socket-handler";
import { Settings } from "./settings";
import checkVersion from "./check-version";
import dayjs from "dayjs";
import { R } from "redbean-node";
import { genSecret, isDev, LooseObject } from "../common/util-common";
import { generatePasswordHash, verifyPassword } from "./password-hash";
import { Bean } from "redbean-node/dist/bean";
import { Arguments, Config, DockgeSocket } from "./util-server";
import { DockerSocketHandler } from "./agent-socket-handlers/docker-socket-handler";
import expressStaticGzip from "express-static-gzip";
import path from "path";
import yaml from "yaml";
import { TerminalSocketHandler } from "./agent-socket-handlers/terminal-socket-handler";
import { Stack } from "./stack";
import { Cron } from "croner";
import gracefulShutdown from "http-graceful-shutdown";
import User from "./models/user";
import childProcessAsync from "promisify-child-process";
import { AgentManager } from "./agent-manager";
import { AgentProxySocketHandler } from "./socket-handlers/agent-proxy-socket-handler";
import { AgentSocketHandler } from "./agent-socket-handler";
import { AgentSocket } from "../common/agent-socket";
import { ManageAgentSocketHandler } from "./socket-handlers/manage-agent-socket-handler";
import { Terminal } from "./terminal";

export class DockgeServer {
    app : Express;
    httpServer : http.Server;
    packageJSON : PackageJson;
    io : socketIO.Server;
    config : Config;
    indexHTML : string = "";

    /**
     * List of express routers
     */
    routerList : Router[] = [
        new MainRouter(),
    ];

    /**
     * List of socket handlers (no agent support)
     */
    socketHandlerList : SocketHandler[] = [
        new MainSocketHandler(),
        new ManageAgentSocketHandler(),
    ];

    agentProxySocketHandler = new AgentProxySocketHandler();

    /**
     * List of socket handlers (support agent)
     */
    agentSocketHandlerList : AgentSocketHandler[] = [
        new DockerSocketHandler(),
        new TerminalSocketHandler(),
    ];

    /**
     * Show Setup Page
     */
    needSetup = false;

    /**
     * GPU Support Available (htop-gpu installed on host)
     */
    hasGPUSupport = false;

    /**
     * Cached Docker stats (updated every 5 seconds in background)
     */
    cachedDockerStats : Map<string, object> = new Map();

    /**
     * Cached GPU stats (updated every 5 seconds in background)
     */
    cachedGPUStats : Map<string, object> = new Map();

    /**
     * Background task interval ID for stats caching
     */
    statsRefreshInterval: NodeJS.Timer | null = null;

    /**
     * ========== NGINX CONFIGURATION PROPERTIES ==========
     */

    /**
     * Enable automatic Nginx config generation on stack create/update
     */
    generateNginxOnStackCreate: boolean = true;

    /**
     * Automatically restart Nginx when configs are updated
     */
    nginxAutoRestart: boolean = false;

    /**
     * Nginx configuration directory (where configs are stored)
     */
    nginxConfigDir: string = "/etc/nginx/sites-available";

    /**
     * Nginx symlink directory (where symlinks are created)
     */
    nginxSymlinkDir: string = "/etc/nginx/sites-enabled";

    /**
     * ACME challenge directory (for Let's Encrypt)
     */
    nginxAcmeDir: string = "/var/www/acme";

    /**
     * SSL certificate path
     */
    nginxSslCert: string = "/etc/nginx/ssl/wildcard.crt";

    /**
     * SSL key path
     */
    nginxSslKey: string = "/etc/nginx/ssl/wildcard.key";

    /**
     * Domain suffix for generated FQDNs (e.g., "sslip.io", "example.com")
     */
    nginxDomainSuffix: string = "sslip.io";

    /**
     * List of IP addresses allowed to access services via Nginx
     */
    nginxAllowedIps: string[] = ["127.0.0.1"];

    /**
     * Default port if no preset is found
     */
    nginxDefaultPort: number = 8080;

    /**
     * Cache of existing Nginx configurations loaded from nginxConfigDir
     */
    nginxConfigCache: { [stackName: string]: any } = {};

    /**
     * ========== END NGINX PROPERTIES ==========
     */

    jwtSecret : string = "";

    stacksDir : string = "";

    /**
     *
     */
    constructor() {
        // Catch unexpected errors here
        let unexpectedErrorHandler = (error : unknown) => {
            console.trace(error);
            console.error("If you keep encountering errors, please report to https://github.com/louislam/dockge");
        };
        process.addListener("unhandledRejection", unexpectedErrorHandler);
        process.addListener("uncaughtException", unexpectedErrorHandler);

        if (!process.env.NODE_ENV) {
            process.env.NODE_ENV = "production";
        }

        // Log NODE ENV
        log.info("server", "NODE_ENV: " + process.env.NODE_ENV);

        // Default stacks directory
        let defaultStacksDir;
        if (process.platform === "win32") {
            defaultStacksDir = "./stacks";
        } else {
            defaultStacksDir = "/opt/stacks";
        }

        // Define all possible arguments
        let args = parse<Arguments>({
            sslKey: {
                type: String,
                optional: true,
            },
            sslCert: {
                type: String,
                optional: true,
            },
            sslKeyPassphrase: {
                type: String,
                optional: true,
            },
            port: {
                type: Number,
                optional: true,
            },
            hostname: {
                type: String,
                optional: true,
            },
            dataDir: {
                type: String,
                optional: true,
            },
            stacksDir: {
                type: String,
                optional: true,
            },
            enableConsole: {
                type: Boolean,
                optional: true,
                defaultValue: false,
            }
        });

        this.config = args as Config;

        // Load from environment variables or default values if args are not set
        this.config.sslKey = args.sslKey || process.env.DOCKGE_SSL_KEY || undefined;
        this.config.sslCert = args.sslCert || process.env.DOCKGE_SSL_CERT || undefined;
        this.config.sslKeyPassphrase = args.sslKeyPassphrase || process.env.DOCKGE_SSL_KEY_PASSPHRASE || undefined;
        this.config.port = args.port || Number(process.env.DOCKGE_PORT) || 5001;
        this.config.hostname = args.hostname || process.env.DOCKGE_HOSTNAME || undefined;
        this.config.dataDir = args.dataDir || process.env.DOCKGE_DATA_DIR || "./data/";
        this.config.stacksDir = args.stacksDir || process.env.DOCKGE_STACKS_DIR || defaultStacksDir;
        this.config.enableConsole = args.enableConsole || process.env.DOCKGE_ENABLE_CONSOLE === "true" || false;
        this.stacksDir = this.config.stacksDir;

        log.debug("server", this.config);

        this.packageJSON = packageJSON as PackageJson;

        try {
            this.indexHTML = fs.readFileSync("./frontend-dist/index.html").toString();
        } catch (e) {
            // "dist/index.html" is not necessary for development
            if (process.env.NODE_ENV !== "development") {
                log.error("server", "Error: Cannot find 'frontend-dist/index.html', did you install correctly?");
                process.exit(1);
            }
        }

        // Create express
        this.app = express();

        // Create HTTP server
        if (this.config.sslKey && this.config.sslCert) {
            log.info("server", "Server Type: HTTPS");
            this.httpServer = https.createServer({
                key: fs.readFileSync(this.config.sslKey),
                cert: fs.readFileSync(this.config.sslCert),
                passphrase: this.config.sslKeyPassphrase,
            }, this.app);
        } else {
            log.info("server", "Server Type: HTTP");
            this.httpServer = http.createServer(this.app);
        }

        // Binding Routers
        for (const router of this.routerList) {
            this.app.use(router.create(this.app, this));
        }

        // Static files
        this.app.use("/", expressStaticGzip("frontend-dist", {
            enableBrotli: true,
        }));

        // JSON body parser for API routes
        this.app.use(express.json());

        // API REST endpoint for authentication (required for setup scripts)
        this.app.post("/api/login", async (req, res) => {
            try {
                // For Express requests, use req.ip directly (no Socket.io object)
                const clientIP = req.ip || "unknown";
                
                const { username, password } = req.body;
                
                // Validation
                if (!username || typeof username !== "string") {
                    log.warn("auth", `API Login: Missing or invalid username. IP=${clientIP}`);
                    return res.status(400).json({ 
                        ok: false, 
                        msg: "Missing or invalid username" 
                    });
                }
                
                if (!password || typeof password !== "string") {
                    log.warn("auth", `API Login: Missing or invalid password. IP=${clientIP}`);
                    return res.status(400).json({ 
                        ok: false, 
                        msg: "Missing or invalid password" 
                    });
                }
                
                // Find user in database
                const user = await R.findOne("user", " username = ? AND active = 1 ", [username]) as User;
                
                if (!user) {
                    log.warn("auth", `API Login: User not found or inactive: ${username}. IP=${clientIP}`);
                    return res.status(401).json({ 
                        ok: false, 
                        msg: "Invalid credentials" 
                    });
                }
                
                // Verify password
                if (!verifyPassword(password, user.password)) {
                    log.warn("auth", `API Login: Invalid password for user: ${username}. IP=${clientIP}`);
                    return res.status(401).json({ 
                        ok: false, 
                        msg: "Invalid credentials" 
                    });
                }
                
                // Generate JWT token
                const token = User.createJWT(user, this.jwtSecret);
                
                log.info("auth", `API Login: Successfully authenticated user ${username}. IP=${clientIP}`);
                
                res.json({ 
                    ok: true, 
                    token: token,
                    msg: "Login successful" 
                });
                
            } catch (error) {
                const err = error as Error;
                log.error("auth", `API Login error: ${err.message}`);
                res.status(500).json({ 
                    ok: false, 
                    msg: "Internal server error" 
                });
            }
        });

        // Universal Route Handler, must be at the end of all express routes.
        this.app.get("*", async (_request, response) => {
            response.send(this.indexHTML);
        });

        // Allow all CORS origins in development
        let cors = undefined;
        if (isDev) {
            cors = {
                origin: "*",
            };
        }

        // Create Socket.io
        this.io = new socketIO.Server(this.httpServer, {
            cors,
            allowRequest: (req, callback) => {
                let isOriginValid = true;
                const bypass = isDev || process.env.UPTIME_KUMA_WS_ORIGIN_CHECK === "bypass";

                if (!bypass) {
                    let host = req.headers.host;

                    // If this is set, it means the request is from the browser
                    let origin = req.headers.origin;

                    // If this is from the browser, check if the origin is allowed
                    if (origin) {
                        try {
                            let originURL = new URL(origin);

                            if (host !== originURL.host) {
                                isOriginValid = false;
                                log.error("auth", `Origin (${origin}) does not match host (${host}), IP: ${req.socket.remoteAddress}`);
                            }
                        } catch (e) {
                            // Invalid origin url, probably not from browser
                            isOriginValid = false;
                            log.error("auth", `Invalid origin url (${origin}), IP: ${req.socket.remoteAddress}`);
                        }
                    } else {
                        log.info("auth", `Origin is not set, IP: ${req.socket.remoteAddress}`);
                    }
                } else {
                    log.debug("auth", "Origin check is bypassed");
                }

                callback(null, isOriginValid);
            }
        });

        this.io.on("connection", async (socket: Socket) => {
            let dockgeSocket = socket as DockgeSocket;
            dockgeSocket.instanceManager = new AgentManager(dockgeSocket);
            dockgeSocket.emitAgent = (event : string, ...args : unknown[]) => {
                let obj = args[0];
                if (typeof(obj) === "object") {
                    let obj2 = obj as LooseObject;
                    obj2.endpoint = dockgeSocket.endpoint;
                }
                dockgeSocket.emit("agent", event, ...args);
            };

            if (typeof(socket.request.headers.endpoint) === "string") {
                dockgeSocket.endpoint = socket.request.headers.endpoint;
            } else {
                dockgeSocket.endpoint = "";
            }

            if (dockgeSocket.endpoint) {
                log.info("server", "Socket connected (agent), as endpoint " + dockgeSocket.endpoint);
            } else {
                log.info("server", "Socket connected (direct)");
            }

            this.sendInfo(dockgeSocket, true);

            if (this.needSetup) {
                log.info("server", "Redirect to setup page");
                dockgeSocket.emit("setup");
            }

            // Create socket handlers (original, no agent support)
            for (const socketHandler of this.socketHandlerList) {
                socketHandler.create(dockgeSocket, this);
            }

            // Create Agent Socket
            let agentSocket = new AgentSocket();

            // Create agent socket handlers
            for (const socketHandler of this.agentSocketHandlerList) {
                socketHandler.create(dockgeSocket, this, agentSocket);
            }

            // Create agent proxy socket handlers
            this.agentProxySocketHandler.create2(dockgeSocket, this, agentSocket);

            // ***************************
            // Better do anything after added all socket handlers here
            // ***************************

            log.debug("auth", "check auto login");
            if (await Settings.get("disableAuth")) {
                log.info("auth", "Disabled Auth: auto login to admin");
                this.afterLogin(dockgeSocket, await R.findOne("user") as User);
                dockgeSocket.emit("autoLogin");
            } else {
                // Try to authenticate via JWT token from cookie (injected by Nginx proxy)
                const cookieHeader = socket.request.headers.cookie || (socket.handshake as any).headers.cookie || "";
                let tokenValid = false;
                
                log.debug("auth", `Socket.io cookie header: ${cookieHeader ? cookieHeader.substring(0, 50) + "..." : "(empty)"}`);
                
                if (cookieHeader) {
                    const cookies = cookieHeader.split(';').map(c => c.trim());
                    for (const cookie of cookies) {
                        if (cookie.startsWith('token=')) {
                            const token = cookie.substring(6);
                            log.debug("auth", `Found JWT token, length: ${token.length}`);
                            try {
                                const decoded = jwt.verify(token, this.jwtSecret) as any;
                                log.debug("auth", `JWT decoded successfully. Username: ${decoded.username}`);
                                
                                // Token is valid, find and login user by username
                                const user = await R.findOne("user", " username = ? AND active = 1 ", [decoded.username]) as User;
                                if (user) {
                                    this.afterLogin(dockgeSocket, user);
                                    log.info("auth", `Socket.io auto-login via JWT token for user: ${user.username}`);
                                    tokenValid = true;
                                    dockgeSocket.emit("autoLogin");
                                } else {
                                    log.warn("auth", `JWT token valid but user not found in DB. Decoded data: id=${decoded.id}, username=${decoded.username}`);
                                }
                                break;
                            } catch (error) {
                                log.warn("auth", `Invalid or expired JWT token in Socket.io connection: ${(error as Error).message}`);
                            }
                            break;
                        }
                    }
                } else {
                    log.debug("auth", "No cookie header found in Socket.io connection");
                }
                
                if (!tokenValid) {
                    log.debug("auth", "need auth");
                }
            }

            // Socket disconnect
            dockgeSocket.on("disconnect", () => {
                log.info("server", "Socket disconnected!");
                dockgeSocket.instanceManager.disconnectAll();
            });

        });

        this.io.on("disconnect", () => {

        });

        if (isDev) {
            setInterval(() => {
                log.debug("terminal", "Terminal count: " + Terminal.getTerminalCount());
            }, 5000);
        }
    }

    async afterLogin(socket : DockgeSocket, user : User) {
        socket.userID = user.id;
        socket.join(user.id.toString());

        this.sendInfo(socket);

        try {
            this.sendStackList();
        } catch (e) {
            log.error("server", e);
        }

        socket.instanceManager.sendAgentList();

        // Also connect to other dockge instances
        socket.instanceManager.connectAll();
    }

    /**
     *
     */
    async serve() {
        // Create all the necessary directories
        this.initDataDir();

        // Initialize GPU support detection
        await this.initGPUSupport();

        // Start background stats refresh task
        this.startStatsRefreshTask();

        // Connect to database
        try {
            await Database.init(this);
        } catch (e) {
            if (e instanceof Error) {
                log.error("server", "Failed to prepare your database: " + e.message);
            }
            process.exit(1);
        }

        // Load existing Nginx configurations
        if (this.generateNginxOnStackCreate) {
            try {
                const { loadExistingNginxConfigs } = await import("./nginx-config-loader");
                this.nginxConfigCache = await loadExistingNginxConfigs(this.nginxConfigDir);
            } catch (e) {
                log.warn("server", `Failed to load Nginx configs: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        // First time setup if needed
        let jwtSecretBean = await R.findOne("setting", " `key` = ? ", [
            "jwtSecret",
        ]);

        if (! jwtSecretBean) {
            log.info("server", "JWT secret is not found, generate one.");
            jwtSecretBean = await this.initJWTSecret();
            log.info("server", "Stored JWT secret into database");
        } else {
            log.debug("server", "Load JWT secret from database.");
        }

        this.jwtSecret = jwtSecretBean.value;

        const userCount = (await R.knex("user").count("id as count").first()).count;

        log.debug("server", "User count: " + userCount);

        // If there is no record in user table, it is a new Dockge instance, need to setup
        if (userCount == 0) {
            log.info("server", "No user, need setup");
            this.needSetup = true;
        }

        // Listen
        this.httpServer.listen(this.config.port, this.config.hostname, () => {
            if (this.config.hostname) {
                log.info( "server", `Listening on ${this.config.hostname}:${this.config.port}`);
            } else {
                log.info("server", `Listening on ${this.config.port}`);
            }

            // Run every 10 seconds
            Cron("*/10 * * * * *", {
                protect: true,  // Enabled over-run protection.
            }, () => {
                //log.debug("server", "Cron job running");
                this.sendStackList(true);
            });

            checkVersion.startInterval();
        });

        gracefulShutdown(this.httpServer, {
            signals: "SIGINT SIGTERM",
            timeout: 30000,                   // timeout: 30 secs
            development: false,               // not in dev mode
            forceExit: true,                  // triggers process.exit() at the end of shutdown process
            onShutdown: this.shutdownFunction,     // shutdown function (async) - e.g. for cleanup DB, ...
            finally: this.finalFunction,            // finally function (sync) - e.g. for logging
        });

    }

    /**
     * Emits the version information to the client.
     * @param socket Socket.io socket instance
     * @param hideVersion Should we hide the version information in the response?
     * @returns
     */
    async sendInfo(socket : Socket, hideVersion = false) {
        let versionProperty;
        let latestVersionProperty;
        let isContainer;

        if (!hideVersion) {
            versionProperty = packageJSON.version;
            latestVersionProperty = checkVersion.latestVersion;
            isContainer = (process.env.DOCKGE_IS_CONTAINER === "1");
        }

        socket.emit("info", {
            version: versionProperty,
            latestVersion: latestVersionProperty,
            isContainer,
            primaryHostname: await Settings.get("primaryHostname"),
            nginxDomainSuffix: this.nginxDomainSuffix,
            nginxEnabled: this.generateNginxOnStackCreate,
            nginxConfigCache: this.nginxConfigCache,
            //serverTimezone: await this.getTimezone(),
            //serverTimezoneOffset: this.getTimezoneOffset(),
        });
    }

    /**
     * Get the IP of the client connected to the socket
     * @param {Socket} socket Socket to query
     * @returns IP of client
     */
    async getClientIP(socket : Socket) : Promise<string> {
        let clientIP = socket.client.conn.remoteAddress;

        if (clientIP === undefined) {
            clientIP = "";
        }

        if (await Settings.get("trustProxy")) {
            const forwardedFor = socket.client.conn.request.headers["x-forwarded-for"];

            if (typeof forwardedFor === "string") {
                return forwardedFor.split(",")[0].trim();
            } else if (typeof socket.client.conn.request.headers["x-real-ip"] === "string") {
                return socket.client.conn.request.headers["x-real-ip"];
            }
        }
        return clientIP.replace(/^::ffff:/, "");
    }

    /**
     * Attempt to get the current server timezone
     * If this fails, fall back to environment variables and then make a
     * guess.
     * @returns {Promise<string>} Current timezone
     */
    async getTimezone() {
        // From process.env.TZ
        try {
            if (process.env.TZ) {
                this.checkTimezone(process.env.TZ);
                return process.env.TZ;
            }
        } catch (e) {
            if (e instanceof Error) {
                log.warn("timezone", e.message + " in process.env.TZ");
            }
        }

        const timezone = await Settings.get("serverTimezone");

        // From Settings
        try {
            log.debug("timezone", "Using timezone from settings: " + timezone);
            if (timezone) {
                this.checkTimezone(timezone);
                return timezone;
            }
        } catch (e) {
            if (e instanceof Error) {
                log.warn("timezone", e.message + " in settings");
            }
        }

        // Guess
        try {
            const guess = dayjs.tz.guess();
            log.debug("timezone", "Guessing timezone: " + guess);
            if (guess) {
                this.checkTimezone(guess);
                return guess;
            } else {
                return "UTC";
            }
        } catch (e) {
            // Guess failed, fall back to UTC
            log.debug("timezone", "Guessed an invalid timezone. Use UTC as fallback");
            return "UTC";
        }
    }

    /**
     * Get the current offset
     * @returns {string} Time offset
     */
    getTimezoneOffset() {
        return dayjs().format("Z");
    }

    /**
     * Throw an error if the timezone is invalid
     * @param {string} timezone Timezone to test
     * @returns {void}
     * @throws The timezone is invalid
     */
    checkTimezone(timezone : string) {
        try {
            dayjs.utc("2013-11-18 11:55").tz(timezone).format();
        } catch (e) {
            throw new Error("Invalid timezone:" + timezone);
        }
    }

    /**
     * Initialize the data directory
     */
    initDataDir() {
        if (! fs.existsSync(this.config.dataDir)) {
            fs.mkdirSync(this.config.dataDir, { recursive: true });
        }

        // Check if a directory
        if (!fs.lstatSync(this.config.dataDir).isDirectory()) {
            throw new Error(`Fatal error: ${this.config.dataDir} is not a directory`);
        }

        // Create data/stacks directory
        if (!fs.existsSync(this.stacksDir)) {
            fs.mkdirSync(this.stacksDir, { recursive: true });
        }

        log.info("server", `Data Dir: ${this.config.dataDir}`);
    }

    /**
     * Init or reset JWT secret
     * @returns  JWT secret
     */
    async initJWTSecret() : Promise<Bean> {
        let jwtSecretBean = await R.findOne("setting", " `key` = ? ", [
            "jwtSecret",
        ]);

        if (!jwtSecretBean) {
            jwtSecretBean = R.dispense("setting");
            jwtSecretBean.key = "jwtSecret";
        }

        jwtSecretBean.value = generatePasswordHash(genSecret());
        await R.store(jwtSecretBean);
        return jwtSecretBean;
    }

    /**
     * Send stack list to all connected sockets
     * @param useCache
     */
    async sendStackList(useCache = false) {
        let socketList = this.io.sockets.sockets.values();

        let stackList;

        for (let socket of socketList) {
            let dockgeSocket = socket as DockgeSocket;

            // Check if the room is a number (user id)
            if (dockgeSocket.userID) {

                // Get the list only if there is a logged in user
                if (!stackList) {
                    stackList = await Stack.getStackList(this, useCache);
                }

                let map : Map<string, object> = new Map();

                for (let [ stackName, stack ] of stackList) {
                    map.set(stackName, stack.toSimpleJSON(dockgeSocket.endpoint));
                }

                log.debug("server", "Send stack list to user: " + dockgeSocket.id + " (" + dockgeSocket.endpoint + ")");
                dockgeSocket.emitAgent("stackList", {
                    ok: true,
                    stackList: Object.fromEntries(map),
                });
            }
        }
    }

    async getDockerNetworkList() : Promise<string[]> {
        let res = await childProcessAsync.spawn("docker", [ "network", "ls", "--format", "{{.Name}}" ], {
            encoding: "utf-8",
        });

        if (!res.stdout) {
            return [];
        }

        let list = res.stdout.toString().split("\n");

        // Remove empty string item
        list = list.filter((item) => {
            return item !== "";
        }).sort((a, b) => {
            return a.localeCompare(b);
        });

        return list;
    }

    /**
     * Initialize GPU support detection by checking if htop-gpu is available
     */
    private async initGPUSupport() {
        try {
            const res = await childProcessAsync.spawn("htop-gpu", ["-h"], {
                encoding: "utf-8",
            });
            // Check if help output exists (command succeeded)
            if (res.stdout || res.stderr) {
                this.hasGPUSupport = true;
                log.info("server", "GPU support: enabled (htop-gpu)");
            } else {
                this.hasGPUSupport = false;
                log.info("server", "GPU support: disabled");
            }
        } catch (e) {
            this.hasGPUSupport = false;
            log.debug("server", "GPU support: disabled - htop-gpu not available");
        }
    }

    /**
     * Background task: refresh Docker and GPU stats every 5 seconds
     */
    private startStatsRefreshTask() {
        // Initial fetch immediately
        this.refreshStatsCache();

        // Then refresh every 5 seconds
        this.statsRefreshInterval = setInterval(async () => {
            try {
                await this.refreshStatsCache();
                log.debug("server", "Background stats cache updated");
            } catch (e) {
                log.error("server", "Error refreshing stats cache: " + (e as Error).message);
            }
        }, 5000);
    }

    private async refreshStatsCache() {
        try {
            this.cachedDockerStats = await this.getDockerStatsRaw();
            this.cachedGPUStats = await this.getDockerGPUMemoryStatsRaw();
        } catch (e) {
            log.error("server", "Error fetching initial stats: " + (e as Error).message);
        }
    }

    /**
     * Get cached Docker stats (from background task)
     */
    async getDockerStats() : Promise<Map<string, object>> {
        return this.cachedDockerStats;
    }

    /**
     * Raw Docker stats collection (called by background task)
     */
    async getDockerStatsRaw() : Promise<Map<string, object>> {
        let stats = new Map<string, object>();

        try {
            let res = await childProcessAsync.spawn("docker", [ "stats", "--format", "json", "--no-stream" ], {
                encoding: "utf-8",
            });

            if (!res.stdout) {
                return stats;
            }

            let lines = res.stdout?.toString().split("\n");

            for (let line of lines) {
                try {
                    let obj = JSON.parse(line);
                    stats.set(obj.Name, obj);
                } catch (e) {
                }
            }

            return stats;
        } catch (e) {
            log.error("getDockerStats", e);
            return stats;
        }
    }

    /**
     * Get cached GPU memory stats (from background task)
     */
    async getDockerGPUMemoryStats() : Promise<Map<string, object>> {
        return this.cachedGPUStats;
    }

    /**
     * Get mapping of container names to stack names by reading compose files
     * Builds a map from container_name (in compose files) to stack name
     */
    async getContainerToStackMapping(): Promise<Map<string, string>> {
        const mapping = new Map<string, string>();

        try {
            // Get all managed stacks
            const stacks = await Stack.getStackList(this);
            log.info("server", "🔍 getContainerToStackMapping: Found " + stacks.size + " stacks");
            
            for (const [stackName, stack] of stacks) {
                try {
                    log.info("server", `  📚 Stack "${stackName}": reading compose...`);
                    
                    // Get the compose YAML
                    const composeYAML = stack.composeYAML;
                    if (!composeYAML) {
                        log.info("server", `    ❌ No compose YAML found`);
                        continue;
                    }

                    // Parse YAML to find container names
                    const parsed = yaml.parse(composeYAML);
                    if (!parsed.services) {
                        log.info("server", `    ❌ No services found in compose`);
                        continue;
                    }

                    log.info("server", `    ✓ Services: ${Object.keys(parsed.services).join(", ")}`);

                    // Check each service for container_name
                    for (const serviceName in parsed.services) {
                        const service = parsed.services[serviceName];
                        if (service.container_name) {
                            mapping.set(service.container_name, stackName);
                            log.info("server", `      ✓ Map "${service.container_name}" → stack "${stackName}"`);
                        }
                    }
                } catch (e) {
                    log.error("server", `❌ Failed to parse compose for stack ${stackName}: ${(e as Error).message}`);
                }
            }

            log.info("server", "✅ Final mapping: " + JSON.stringify(Object.fromEntries(mapping)));
            return mapping;
        } catch (e) {
            log.error("server", "❌ Failed to get container to stack mapping: " + (e as Error).message);
            return mapping;
        }
    }

    /**
     * Raw GPU memory stats collection (called by background task)
     */
    async getDockerGPUMemoryStatsRaw() : Promise<Map<string, object>> {
        let gpuStats = new Map<string, object>();

        if (!this.hasGPUSupport) {
            return gpuStats;
        }

        try {
            // Get container to stack mapping
            const containerToStack = await this.getContainerToStackMapping();

            const res = await childProcessAsync.spawn("htop-gpu", ["--json"], {
                encoding: "utf-8",
            });

            if (!res.stdout) {
                return gpuStats;
            }

            const output = res.stdout.toString();
            const jsonData = JSON.parse(output);

            // Parse htop-gpu JSON output to extract GPU memory per container
            // Expected structure: { "processes": [ { "container_name": "name", "gpu_mem_mib": 102, ... }, ... ] }
            if (jsonData.processes && Array.isArray(jsonData.processes)) {
                for (const proc of jsonData.processes) {
                    if (!proc.container_name) {
                        continue;
                    }

                    const containerName = proc.container_name.trim();
                    const gpuMemMib = proc.gpu_mem_mib ? parseInt(proc.gpu_mem_mib) : 0;

                    if (gpuMemMib > 0) {
                        // Use stack name as key if available, otherwise use container name
                        const key = containerToStack.get(containerName) || containerName;
                        
                        // Sum GPU memory if key already exists (multiple containers in stack or multiple processes)
                        if (gpuStats.has(key)) {
                            const existing = gpuStats.get(key) as { gpu_memory_mib: number };
                            existing.gpu_memory_mib += gpuMemMib;
                        } else {
                            gpuStats.set(key, { gpu_memory_mib: gpuMemMib });
                        }
                    }
                }
            }

            log.debug("server", "GPU stats collected (by stack): " + JSON.stringify(Object.fromEntries(gpuStats)));
            return gpuStats;
        } catch (e) {
            log.debug("server", "Failed to get GPU stats: " + (e as Error).message);
            return gpuStats;
        }
    }

    get stackDirFullPath() {
        return path.resolve(this.stacksDir);
    }

    /**
     * Shutdown the application
     * Stops all monitors and closes the database connection.
     * @param signal The signal that triggered this function to be called.
     */
    async shutdownFunction(signal : string | undefined) {
        log.info("server", "Shutdown requested");
        log.info("server", "Called signal: " + signal);

        // TODO: Close all terminals?

        // Stop background stats refresh task
        if (this.statsRefreshInterval) {
            clearInterval(this.statsRefreshInterval);
            this.statsRefreshInterval = null;
        }

        await Database.close();
        Settings.stopCacheCleaner();
    }

    /**
     * Final function called before application exits
     */
    finalFunction() {
        log.info("server", "Graceful shutdown successful!");
    }

    /**
     * Force connected sockets of a user to refresh and disconnect.
     * Used for resetting password.
     * @param {string} userID
     * @param {string?} currentSocketID
     */
    disconnectAllSocketClients(userID: number | undefined, currentSocketID? : string) {
        for (const rawSocket of this.io.sockets.sockets.values()) {
            let socket = rawSocket as DockgeSocket;
            if ((!userID || socket.userID === userID) && socket.id !== currentSocketID) {
                try {
                    socket.emit("refresh");
                    socket.disconnect();
                } catch (e) {

                }
            }
        }
    }

    isSSL() {
        return this.config.sslKey && this.config.sslCert;
    }

    getLocalWebSocketURL() {
        const protocol = this.isSSL() ? "wss" : "ws";
        const host = this.config.hostname || "localhost";
        return `${protocol}://${host}:${this.config.port}`;
    }

}
