import * as pm2 from 'pm2';
import { IS_DEVELOPMENT, SERVER_NAME } from './common-types';
import { LRUCache } from 'lru-cache';

const nodeIds = [];

pm2.connect(function () {
    pm2.list(function (err, processes) {
        for (const i in processes) {
            if (processes[i].name === SERVER_NAME) {
                nodeIds.push(processes[i].pm_id);
            }
        }
    });
});

const ITEM_TTL = 1000 * 60 * 60 * 24; // 1 day

class P2PCacheInstance {
    private readonly cache: LRUCache<string, any> = new LRUCache({
        max: 100000,
        ttl: ITEM_TTL,
    });

    public constructor() {
        process.on('message', this.onMessage.bind(this));
    }

    private onMessage(packet: any) {
        if (typeof packet !== 'object') {
            return;
        }

        if (packet?.type === 'set') {
            if (!packet?.data?.key || !packet?.data?.value || !packet?.data?.ttl) {
                return;
            }

            this.cache.set(packet.data.key, packet.data.value, { ttl: packet.data.ttl });
        }

        if (packet?.type === 'delete') {
            if (!packet?.data?.key) {
                return;
            }

            this.cache.delete(packet.data.key);
        }
    }

    public set(key: string, value: any, ttl: number = ITEM_TTL) {
        this.onMessage({ type: 'set', data: { key, value, ttl } });

        if (IS_DEVELOPMENT) {
            return;
        }

        for (const nodeId of nodeIds) {
            pm2.sendDataToProcessId(
                nodeId,
                {
                    type: 'set',
                    data: {
                        key,
                        value,
                        ttl,
                    },
                    topic: true,
                },
                (err, res) => {
                    // nothing
                },
            );
        }
    }

    public delete(key: string) {
        this.onMessage({ type: 'delete', data: { key } });

        if (IS_DEVELOPMENT) {
            return;
        }

        for (const nodeId of nodeIds) {
            pm2.sendDataToProcessId(
                nodeId,
                {
                    type: 'delete',
                    data: {
                        key,
                    },
                    topic: true,
                },
                (err, res) => {
                    // nothing
                },
            );
        }
    }

    public get(key: string) {
        return this.cache.get(key);
    }

    public has(key: string): boolean {
        return this.cache.has(key);
    }

    public ttl(key: string) {
        return this.cache.getRemainingTTL(key);
    }
}

const P2PCache = new P2PCacheInstance();
export default P2PCache;
