import { Database } from "../backend/database";
import { R } from "redbean-node";
import { User } from "../backend/models/user";
import { DockgeServer } from "../backend/dockge-server";
import { log } from "../backend/log";
import { generatePasswordHash } from "../backend/password-hash";
import { passwordStrength } from "check-password-strength";
import { io } from "socket.io-client";

console.log("== Dockge Add User Tool ==");

const server = new DockgeServer();

export const main = async () => {
    const username = process.env.USER;
    const password = process.env.PASSWORD;

    // Validate input
    if (!username) {
        console.error("Error: USER environment variable is not set.");
        process.exit(1);
    }

    if (!password) {
        console.error("Error: PASSWORD environment variable is not set.");
        process.exit(1);
    }

    console.log("Connecting to the database");
    try {
        await Database.init(server);
    } catch (e) {
        if (e instanceof Error) {
            log.error("server", "Failed to connect to your database: " + e.message);
        }
        process.exit(1);
    }

    try {
        // Check if user already exists
        const existingUser = await R.findOne("user", " username = ? ", [username]);
        if (existingUser) {
            throw new Error(`User "${username}" already exists.`);
        }

        // Validate password strength
        const strength = passwordStrength(password);
        if (strength.value === "Too weak") {
            throw new Error("Password is too weak. It should contain alphabetic and numeric characters. It must be at least 6 characters in length.");
        }

        // Create new user
        const user = R.dispense("user");
        user.username = username;
        user.password = generatePasswordHash(password);
        await R.store(user);

        console.log(`User "${username}" created successfully.`);

        // Notify the running server to refresh needSetup status
        await notifyServerRefreshNeedSetup(server);
    } catch (e) {
        if (e instanceof Error) {
            console.error("Error: " + e.message);
        }
        process.exit(1);
    }

    await Database.close();
    console.log("Finished.");
};

function notifyServerRefreshNeedSetup(server: DockgeServer) : Promise<void> {
    return new Promise((resolve) => {
        const url = server.getLocalWebSocketURL();

        console.log("Notifying server to refresh setup status");

        const socket = io(url, {
            reconnection: false,
            timeout: 5000,
        });

        socket.on("connect", () => {
            socket.emit("refreshNeedSetup", (res : any) => {
                if (res.ok) {
                    console.log("Server setup status refreshed.");
                } else {
                    console.warn("Failed to refresh server status: " + res.msg);
                }
                socket.close();
            });
        });

        socket.on("connect_error", function () {
            console.warn("Failed to connect to " + url);
            console.warn("Server status refresh skipped, but user was created successfully.");
            resolve();
        });

        socket.on("disconnect", () => {
            resolve();
        });
    });
}

if (!process.env.TEST_BACKEND) {
    main();
}
