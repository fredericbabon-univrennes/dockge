<template>
    <div class="shadow-box big-padding mb-3 container">
        <div class="row">
            <div class="col-5">
                <h4>{{ name }}</h4>
                <div class="image mb-2">
                    <span class="me-1">{{ imageName }}:</span><span class="tag">{{ imageTag }}</span>
                </div>
                <div v-if="!isEditMode">
                    <span class="badge me-1" :class="bgStyle">{{ status }}</span>

                    <span v-for="port in (ports ?? envsubstService.ports)" :key="port" class="badge me-1 bg-secondary">{{ parsePort(port).display }}</span>
                </div>
            </div>
            <div class="col-7">
                <div class="function">
                    <div class="btn-group me-2" role="group">
                        <router-link v-if="!isEditMode && (status === 'running' || status === 'healthy')" class="btn btn-normal" :to="terminalRouteLink" disabled="">
                            <font-awesome-icon icon="terminal" />
                            Bash
                        </router-link>
                        <button
                            v-if="serviceCount > 1 && !isEditMode && status !== 'running' && status !== 'healthy'"
                            class="btn btn-primary"
                            :disabled="processing"
                            @click="startService"
                        >
                            <font-awesome-icon icon="play" class="me-1" />
                            {{ $t("startStack") }}
                        </button>
                        <button
                            v-if="serviceCount > 1 && !isEditMode && (status === 'running' || status === 'healthy' || status === 'unhealthy')"
                            class="btn btn-normal"
                            :disabled="processing"
                            @click="restartService"
                        >
                            <font-awesome-icon icon="rotate" class="me-1" />
                            {{ $t("restartStack") }}
                        </button>
                        <button
                            v-if="serviceCount > 1 && !isEditMode && (status === 'running' || status === 'healthy' || status === 'unhealthy')"
                            class="btn btn-normal"
                            :disabled="processing"
                            @click="stopService"
                        >
                            <font-awesome-icon icon="stop" class="me-1" />
                            {{ $t("stopStack") }}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="isEditMode" class="mt-2">
            <button class="btn btn-normal me-2" @click="showConfig = !showConfig">
                <font-awesome-icon icon="edit" />
                {{ $t("Edit") }}
            </button>
            <button v-if="false" class="btn btn-normal me-2">Rename</button>
            <button class="btn btn-danger me-2" @click="remove">
                <font-awesome-icon icon="trash" />
                {{ $t("deleteContainer") }}
            </button>
        </div>
        <div v-else-if="statsInstances.length > 0" class="mt-2">
            <div class="d-flex flex-column gap-3">
                <DockerStat
                    v-for="stat in statsInstances"
                    :key="stat.Name"
                    :stat="stat"
                    :gpuStats="gpuStats"
                    :stackName="stackName"
                />
            </div>
        </div>

        <transition name="slide-fade" appear>
            <div v-if="isEditMode && showConfig" class="config mt-3">
                <!-- Image -->
                <div class="mb-4">
                    <label class="form-label">
                        {{ $t("dockerImage") }}
                    </label>
                    <div class="input-group mb-3">
                        <input
                            v-model="service.image"
                            class="form-control"
                            list="image-datalist"
                        />
                    </div>

                    <!-- TODO: Search online: https://hub.docker.com/api/content/v1/products/search?q=louislam%2Fuptime&source=community&page=1&page_size=4 -->
                    <datalist id="image-datalist">
                        <option value="louislam/uptime-kuma:1" />
                    </datalist>
                    <div class="form-text"></div>
                </div>

                <!-- GPU & Bridge Options -->
                <div class="mb-4">
                    <div class="row">
                        <div class="col-12">
                            <div class="form-check mb-2">
                                <input v-model="enableGpu" type="checkbox" class="form-check-input" :id="'enableGpu_' + name" />
                                <label class="form-check-label" :for="'enableGpu_' + name">
                                    🎮 Enable GPU Support (NVIDIA)
                                </label>
                            </div>
                        </div>

                        <div class="col-12">
                            <div class="form-check">
                                <input v-model="enableBridgeNetwork" type="checkbox" class="form-check-input" :id="'enableBridgeNetwork_' + name" />
                                <label class="form-check-label" :for="'enableBridgeNetwork_' + name">
                                    🌉 Use Bridge Driver
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Ports -->
                <div class="mb-4">
                    <label class="form-label">
                        {{ $tc("port", 2) }}
                    </label>
                    <ArrayInput name="ports" :display-name="$t('port')" placeholder="HOST:CONTAINER" />
                </div>

                <!-- Volumes -->
                <div class="mb-4">
                    <label class="form-label">
                        {{ $tc("volume", 2) }}
                    </label>
                    <ArrayInput name="volumes" :display-name="$t('volume')" placeholder="HOST:CONTAINER" />
                </div>

                <!-- Restart Policy -->
                <div class="mb-4">
                    <label class="form-label">
                        {{ $t("restartPolicy") }}
                    </label>
                    <select v-model="service.restart" class="form-select">
                        <option value="always">{{ $t("restartPolicyAlways") }}</option>
                        <option value="unless-stopped">{{ $t("restartPolicyUnlessStopped") }}</option>
                        <option value="on-failure">{{ $t("restartPolicyOnFailure") }}</option>
                        <option value="no">{{ $t("restartPolicyNo") }}</option>
                    </select>
                </div>

                <!-- Environment Variables -->
                <div class="mb-4">
                    <label class="form-label">
                        {{ $tc("environmentVariable", 2) }}
                    </label>
                    <ArrayInput name="environment" :display-name="$t('environmentVariable')" placeholder="KEY=VALUE" />
                </div>

                <!-- Container Name -->
                <div v-if="false" class="mb-4">
                    <label class="form-label">
                        {{ $t("containerName") }}
                    </label>
                    <div class="input-group mb-3">
                        <input
                            v-model="service.container_name"
                            class="form-control"
                        />
                    </div>
                    <div class="form-text"></div>
                </div>

                <!-- Network -->
                <div class="mb-4">
                    <label class="form-label">
                        {{ $tc("network", 2) }}
                    </label>

                    <div v-if="networkList.length === 0 && service.networks && service.networks.length > 0" class="text-warning mb-3">
                        {{ $t("NoNetworksAvailable") }}
                    </div>

                    <ArraySelect name="networks" :display-name="$t('network')" placeholder="Network Name" :options="networkList" />
                </div>

                <!-- Depends on -->
                <div class="mb-4">
                    <label class="form-label">
                        {{ $t("dependsOn") }}
                    </label>
                    <ArrayInput name="depends_on" :display-name="$t('dependsOn')" :placeholder="$t(`containerName`)" />
                </div>
            </div>
        </transition>
    </div>
</template>

<script>
import { defineComponent } from "vue";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { parseDockerPort } from "../../../common/util-common";
import DockerStat from "./DockerStat.vue";

export default defineComponent({
    components: {
        FontAwesomeIcon,
        DockerStat
    },
    props: {
        name: {
            type: String,
            required: true,
        },
        isEditMode: {
            type: Boolean,
            default: false,
        },
        first: {
            type: Boolean,
            default: false,
        },
        serviceStatus: {
            type: Object,
            default: null,
        },
        dockerStats: {
            type: Object,
            default: null
        },
        gpuStats: {
            type: Object,
            default: null
        }
    },
    emits: [
        "start-service",
        "stop-service",
        "restart-service"
    ],
    data() {
        return {
            showConfig: false,
        };
    },
    computed: {

        networkList() {
            let list = [];
            for (const networkName in this.jsonObject.networks) {
                list.push(networkName);
            }
            return list;
        },

        bgStyle() {
            if (this.status === "running" || this.status === "healthy") {
                return "bg-primary";
            } else if (this.status === "unhealthy") {
                return "bg-danger";
            } else {
                return "bg-secondary";
            }
        },

        terminalRouteLink() {
            if (this.endpoint) {
                return {
                    name: "containerTerminalEndpoint",
                    params: {
                        endpoint: this.endpoint,
                        stackName: this.stackName,
                        serviceName: this.name,
                        type: "bash",
                    },
                };
            } else {
                return {
                    name: "containerTerminal",
                    params: {
                        stackName: this.stackName,
                        serviceName: this.name,
                        type: "bash",
                    },
                };
            }
        },

        endpoint() {
            return this.$parent.$parent.endpoint;
        },

        stack() {
            return this.$parent.$parent.stack;
        },

        stackName() {
            return this.$parent.$parent.stack.name;
        },

        service() {
            if (!this.jsonObject.services[this.name]) {
                return {};
            }
            return this.jsonObject.services[this.name];
        },

        serviceCount() {
            return Object.keys(this.jsonObject.services).length;
        },

        jsonObject() {
            return this.$parent.$parent.jsonConfig;
        },

        envsubstJSONConfig() {
            return this.$parent.$parent.envsubstJSONConfig;
        },

        envsubstService() {
            if (!this.envsubstJSONConfig.services[this.name]) {
                return {};
            }
            return this.envsubstJSONConfig.services[this.name];
        },

        imageName() {
            if (this.envsubstService.image) {
                return this.envsubstService.image.split(":")[0];
            } else {
                return "";
            }
        },

        imageTag() {
            if (this.envsubstService.image) {
                let tag = this.envsubstService.image.split(":")[1];

                if (tag) {
                    return tag;
                } else {
                    return "latest";
                }
            } else {
                return "";
            }
        },
        statsInstances() {
            if (!this.serviceStatus) {
                console.log("🔍 [" + this.name + "] Pas de serviceStatus");
                return [];
            }

            // Wait until dockerStats is populated before matching
            if (!this.dockerStats || Object.keys(this.dockerStats).length === 0) {
                console.log("🔍 [" + this.name + "] dockerStats vides - en attente des données");
                return [];
            }

            console.log("🔍 [" + this.name + "] Service Status:", this.serviceStatus);
            console.log("🔍 [" + this.name + "] Cherche dans dockerStats les clés:", this.serviceStatus.map(s => s.name));
            
            const result = this.serviceStatus
                .map(s => {
                    console.log("🔍 [" + this.name + "] Cherche s.name='" + s.name + "' dans dockerStats:", s.name in this.dockerStats);
                    return this.dockerStats[s.name];
                })
                .filter(s => !!s)
                .sort((a, b) => a.Name.localeCompare(b.Name));
            
            console.log("🔍 [" + this.name + "] statsInstances résultat:", result);
            return result;
        },
        status() {
            if (!this.serviceStatus) {
                return "N/A";
            }
            return this.serviceStatus[0].status;
        },
        enableGpu: {
            get() {
                // La case est cochée si le driver nvidia est présent dans les devices de deploy
                const devices = this.service.deploy?.resources?.reservations?.devices;
                if (!devices) return false;
                return devices.some(d => d.driver === 'nvidia');
            },
            set(newVal) {
                if (newVal) {
                    this.service.deploy = this.service.deploy || {};
                    this.service.deploy.resources = this.service.deploy.resources || {};
                    this.service.deploy.resources.reservations = this.service.deploy.resources.reservations || {};
                    this.service.deploy.resources.reservations.devices = this.service.deploy.resources.reservations.devices || [];
                    
                    const nvidiaExists = this.service.deploy.resources.reservations.devices.some(d => d.driver === 'nvidia');
                    if (!nvidiaExists) {
                        this.service.deploy.resources.reservations.devices.push({
                            driver: 'nvidia',
                            count: 1,
                            capabilities: ['gpu']
                        });
                    }
                } else {
                    if (this.service.deploy?.resources?.reservations?.devices) {
                        this.service.deploy.resources.reservations.devices = this.service.deploy.resources.reservations.devices.filter(d => d.driver !== 'nvidia');
                        
                        // Nettoyage des objets vides
                        if (this.service.deploy.resources.reservations.devices.length === 0) {
                            delete this.service.deploy.resources.reservations.devices;
                        }
                        if (Object.keys(this.service.deploy.resources.reservations).length === 0) {
                            delete this.service.deploy.resources.reservations;
                        }
                        if (Object.keys(this.service.deploy.resources).length === 0) {
                            delete this.service.deploy.resources;
                        }
                        if (Object.keys(this.service.deploy).length === 0) {
                            delete this.service.deploy;
                        }
                    }
                }
            }
        },

        enableBridgeNetwork: {
            get() {
                // Récupère les réseaux de ce service
                let networks = this.service.networks;
                let networkNames = [];
                
                if (typeof networks === 'string') {
                    networkNames = [networks];
                } else if (Array.isArray(networks)) {
                    networkNames = networks;
                } else if (typeof networks === 'object' && networks !== null) {
                    networkNames = Object.keys(networks);
                }
                
                if (networkNames.length === 0) return false;
                
                // La case est cochée si TOUS les réseaux associés à ce service utilisent le driver bridge
                return networkNames.every(networkName => this.jsonObject.networks?.[networkName]?.driver === 'bridge');
            },
            set(newVal) {
                let networks = this.service.networks;
                let networkNames = [];
                
                if (typeof networks === 'string') {
                    networkNames = [networks];
                } else if (Array.isArray(networks)) {
                    networkNames = networks;
                } else if (typeof networks === 'object' && networks !== null) {
                    networkNames = Object.keys(networks);
                }
                
                if (networkNames.length === 0) return;
                
                if (newVal) {
                    if (!this.jsonObject.networks) {
                        this.jsonObject.networks = {};
                    }
                    
                    for (const networkName of networkNames) {
                        if (!this.jsonObject.networks[networkName]) {
                            this.jsonObject.networks[networkName] = {};
                        }
                        this.jsonObject.networks[networkName].driver = 'bridge';
                    }
                } else {
                    for (const networkName of networkNames) {
                        if (this.jsonObject.networks?.[networkName]) {
                            delete this.jsonObject.networks[networkName].driver;
                        }
                    }
                }
            }
        }
    },
    mounted() {
        if (this.first) {
            //this.showConfig = true;
        }
    },    
    methods: {
        parsePort(port) {
            if (this.stack.endpoint) {
                return parseDockerPort(port, this.stack.primaryHostname);
            } else {
                let hostname = this.$root.info.primaryHostname || location.hostname;
                return parseDockerPort(port, hostname);
            }
        },
        remove() {
            delete this.jsonObject.services[this.name];
        },
        startService() {
            this.$emit("start-service", this.name);
        },
        stopService() {
            this.$emit("stop-service", this.name);
        },
        restartService() {
            this.$emit("restart-service", this.name);
        }
    }
});
</script>

<style scoped lang="scss">
@import "../styles/vars";

.container {
    .image {
        font-size: 0.8rem;
        color: #6c757d;
        .tag {
            color: #33383b;
        }
    }

    .function {
        align-content: center;
        display: flex;
        height: 100%;
        width: 100%;
        align-items: center;
        justify-content: end;
    }

    .stats {
        font-size: 0.8rem;
        color: #6c757d;
    }
}
</style>
