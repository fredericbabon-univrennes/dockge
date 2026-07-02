<template>
    <div class="stats-container">
        <div class="stats-title">
            {{ stat.Name }}
        </div>
        <div class="d-flex justify-content-between stats gap-2 mt-1">
            <div class="stat">
                <div class="stat-label">
                    {{ $t('CPU') }}
                </div>
                <div>
                    {{ stat.CPUPerc }}
                </div>
            </div>
            <div class="stat">
                <div class="stat-label">
                    {{ $t('memory') }}
                </div>
                <div>
                    {{ stat.MemUsage }} ({{ stat.MemPerc }})
                </div>
            </div>
            <div class="stat">
                <div class="stat-label">
                    {{ $t('networkIO') }}
                </div>
                <div>
                    {{ stat.NetIO }}
                </div>
            </div>
            <div class="stat">
                <div class="stat-label">
                    {{ $t('blockIO') }}
                </div>
                <div>
                    {{ stat.BlockIO }}
                </div>
            </div>
            <div v-if="stackName && gpuStats && gpuStats[stackName] && gpuStats[stackName].gpu_memory_mib" class="stat">
                <div class="stat-label">
                    🎮 GPU Memory
                </div>
                <div>
                    {{ gpuStats[stackName].gpu_memory_mib }} MiB
                </div>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    props: {
        stat: {
            type: Object,
            required: true
        },
        gpuStats: {
            type: Object,
            default: null
        },
        stackName: {
            type: String,
            default: null
        }
    },
};
</script>

<style lang="scss" scoped>
.stats-container {
    container-type: inline-size;

    .stats {
        container-type: inline-size;

        .stat {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        @container (width < 420px) {
            flex-direction: column;

            .stat {
                flex-direction: row;
            }

            .stat-label::after {
                content: ':'
            }
        }
    }
}

.stats {
    font-size: 0.8rem;
    color: #6c757d;
}

.stat-label {
    font-weight: bold;
}

.stats-title {
    font-size: 0.9rem;
    color: var(--bs-heading-color);
}
</style>
