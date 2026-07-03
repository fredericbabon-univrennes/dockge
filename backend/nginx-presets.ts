/**
 * NGINX Service Presets
 * Predefined configurations for common services with known ports and path prefixes
 * Inspired by startup_instance_new_5.py nginx_services mapping
 */

export interface NginxPreset {
    port: number;
    path_prefix: string;
    description: string;
    ssl_certificate?: string;
    ssl_key?: string;
    proxy_headers?: Record<string, string>;
    requires_special_handling?: boolean;
}

/**
 * Registry of all known service presets
 * Services are recognized by stack name (e.g., stack named "jupyter" uses jupyter preset)
 */
export const NGINX_SERVICE_PRESETS: Record<string, NginxPreset> = {
    // =============== JUPYTER (Path Prefix Required) ===============
    "jupyter": {
        port: 8890,
        path_prefix: "/jupyter/",
        description: "Jupyter Notebook Server with path prefix",
        requires_special_handling: true,
        proxy_headers: {
            "Connection": "upgrade",
            "Upgrade": "$http_upgrade",
        }
    },

    // =============== VSCODE ===============
    "vscode": {
        port: 8443,
        path_prefix: "/",
        description: "VS Code Server (web-based IDE)",
    },

    // =============== OLLAMA ===============
    "ollama": {
        port: 11434,
        path_prefix: "/",
        description: "Ollama LLM Server",
    },

    // =============== OPEN WEBUI ===============
    "openwebui": {
        port: 8080,
        path_prefix: "/",
        description: "Open WebUI (Ollama frontend interface)",
    },

    // =============== INVOKEAI ===============
    "invokeai": {
        port: 9090,
        path_prefix: "/",
        description: "InvokeAI (Stable Diffusion Web UI)",
    },

    // =============== COMFYUI ===============
    "comfyui": {
        port: 8188,
        path_prefix: "/",
        description: "ComfyUI (Node-based Stable Diffusion UI)",
    },

    // =============== SPEACHES ===============
    "speaches": {
        port: 8000,
        path_prefix: "/",
        description: "Speaches (Speech synthesis service)",
    },

    // =============== DOCKGE ITSELF (Special Handling) ===============
    "dockge": {
        port: 5001,
        path_prefix: "/",
        description: "Dockge Management Interface",
        requires_special_handling: true,
    }
};

/**
 * Get preset for a given service name
 * @param serviceName - Name of the service (e.g., "jupyter", "vscode")
 * @returns NginxPreset if found, null otherwise
 */
export function getPresetForService(serviceName: string): NginxPreset | null {
    const normalized = serviceName.toLowerCase().trim();
    return NGINX_SERVICE_PRESETS[normalized] || null;
}

/**
 * Check if a service name matches a known preset
 * @param serviceName - Name of the service
 * @returns true if preset exists for this service
 */
export function hasPreset(serviceName: string): boolean {
    return getPresetForService(serviceName) !== null;
}

/**
 * Get all available presets
 * @returns Record of all presets
 */
export function getAllPresets(): Record<string, NginxPreset> {
    return NGINX_SERVICE_PRESETS;
}

/**
 * Get list of all known service names
 * @returns Array of service names
 */
export function getKnownServices(): string[] {
    return Object.keys(NGINX_SERVICE_PRESETS);
}

/**
 * Get description of a service preset
 * @param serviceName - Name of the service
 * @returns Description string or null
 */
export function getPresetDescription(serviceName: string): string | null {
    const preset = getPresetForService(serviceName);
    return preset ? preset.description : null;
}
