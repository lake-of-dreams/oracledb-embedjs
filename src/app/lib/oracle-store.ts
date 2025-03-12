import createDebugMessages from 'debug';
import { Connection, getConnection } from 'oracledb';
import { BaseStore, Conversation, LoaderListEntry, Message } from '@llm-tools/embedjs-interfaces';
import { DbConfig } from './oracle-db';

export class OracleStore implements BaseStore {
    private readonly debug = createDebugMessages('embedjs:store:OracleStore');
    private readonly loadersCustomDataTableName: string;
    private readonly conversationsTableName: string;
    private readonly loadersTableName: string;
    private readonly dbConfig: DbConfig;
    private connection: Connection | undefined;;

    constructor({
        dbConfig,
        loadersTableName,
        conversationsTableName,
        loadersCustomDataTableName,
    }: {
        dbConfig: DbConfig;
        loadersTableName?: string;
        conversationsTableName?: string;
        loadersCustomDataTableName?: string;
    }) {
        this.loadersCustomDataTableName = loadersCustomDataTableName ?? 'loaderCustomData';
        this.conversationsTableName = conversationsTableName ?? 'conversations';
        this.loadersTableName = loadersTableName ?? 'loaders';
        this.dbConfig = dbConfig;
    }

    async init(): Promise<void> {
        this.debug(`Creating table '${this.conversationsTableName}'`);
        this.connection = await getConnection(this.dbConfig);
        await this.connection.execute(`drop table if exists ${this.conversationsTableName}`);
        await this.connection.execute(`drop index if exists ${this.conversationsTableName}_index`);
        await this.connection.execute(`CREATE TABLE ${this.conversationsTableName} (
            id              VARCHAR2(400) PRIMARY KEY,
            conversationId  VARCHAR2(400) NOT NULL,
            content         VARCHAR2(4000) NOT NULL,
            timestamp       VARCHAR2(400) NOT NULL,
            actor           VARCHAR2(400) NOT NULL,
            sources         VARCHAR2(400)
        )`)

        await this.connection.execute(`CREATE INDEX ${this.conversationsTableName}_index ON ${this.conversationsTableName} (conversationId)`);
        this.debug(`Created table '${this.conversationsTableName}' and related indexes`);

        this.debug(`Creating table '${this.loadersTableName}'`);
        await this.connection.execute(`drop table if exists ${this.loadersTableName}`);
        await this.connection.execute(`CREATE TABLE ${this.loadersTableName} (
            id              VARCHAR2(400) PRIMARY KEY,
            type            VARCHAR2(400) NOT NULL,
            chunksProcessed INTEGER,
            metadata        VARCHAR2(4000)
        )`);
        this.debug(`Created table '${this.loadersTableName}'`);

        this.debug(`Creating table '${this.loadersCustomDataTableName}'`);
        await this.connection.execute(`drop table if exists ${this.loadersCustomDataTableName}`);
        await this.connection.execute(`drop index if exists ${this.loadersCustomDataTableName}_index`);
        await this.connection.execute(`CREATE TABLE ${this.loadersCustomDataTableName} (
            key             VARCHAR2(400) PRIMARY KEY,
            loaderId        VARCHAR2(400) NOT NULL,
            value           VARCHAR2(4000)
        )`)

        await this.connection.execute(`CREATE INDEX ${this.loadersCustomDataTableName}_index ON ${this.loadersCustomDataTableName} (loaderId)`);
        this.debug(`Created table '${this.loadersCustomDataTableName}' and related indexes`);
    }

    async addLoaderMetadata(loaderId: string, value: LoaderListEntry): Promise<void> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        await this.connection.execute(`DELETE FROM ${this.loadersTableName} WHERE id = '${loaderId}'`);

        await this.connection.execute(
            `INSERT INTO ${this.loadersTableName} (id, type, chunksProcessed, metadata)
                VALUES (:1, :2, :3,:4)`,
            [loaderId, value.type, value.chunksProcessed, JSON.stringify(value.loaderMetadata)],
        );
    }

    async getLoaderMetadata(loaderId: string): Promise<LoaderListEntry> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        const results = await this.connection.execute(
            `SELECT type, chunksProcessed, metadata FROM ${this.loadersTableName} WHERE id = :1`,
            [loaderId],
        );

        if (results.rows) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = results.rows[0] as any;
            const metadata = JSON.parse(result[2].toString());

            return {
                uniqueId: loaderId,
                loaderMetadata: metadata,
                chunksProcessed: Number.parseInt(result[1].toString()),
                type: result[0].toString(),
            };
        }

        throw new Error("no rows returned")

    }

    async hasLoaderMetadata(loaderId: string): Promise<boolean> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        const results = await this.connection.execute(
            `SELECT type, chunksProcessed, metadata FROM ${this.loadersTableName} WHERE id = :1`,
            [loaderId],
        );

        return results.rows ? results.rows.length > 0 : false;
    }

    async getAllLoaderMetadata(): Promise<LoaderListEntry[]> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        const results = await this.connection.execute(
            `SELECT id, type, chunksProcessed, metadata FROM ${this.loadersTableName}`,
        );

        if (results.rows) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return results.rows.map((result: any) => {
                const metadata = JSON.parse(result[3].toString());

                return {
                    uniqueId: result[0].toString(),
                    loaderMetadata: metadata,
                    chunksProcessed: Number.parseInt(result[2].toString()),
                    type: result[1].toString(),
                };
            });
        }

        return []

    }

    async loaderCustomSet<T extends Record<string, unknown>>(loaderId: string, key: string, value: T): Promise<void> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        this.debug(`custom set '${key}' with values`, value);
        await this.loaderCustomDelete(key);

        this.debug(`custom set '${key}' insert started`);
        const results = await this.connection.execute(
            `INSERT INTO ${this.loadersCustomDataTableName} (key, loaderId, value)
                VALUES (:1, :2, :3)`,
            [key, loaderId, JSON.stringify(value)],
        );

        this.debug(`custom set for key '${key}' resulted in`, results.rows);
    }

    async loaderCustomGet<T extends Record<string, unknown>>(key: string): Promise<T> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        const results = await this.connection.execute(`SELECT value FROM ${this.loadersCustomDataTableName} WHERE key = :1`,
            [key]);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return results.rows ? JSON.parse((results.rows as any)[0][0].toString()) : {} as any;
    }

    async loaderCustomHas(key: string): Promise<boolean> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        const results = await this.connection.execute(
            `SELECT value FROM ${this.loadersCustomDataTableName} WHERE key = :1`,
            [key],
        );

        return results.rows ? results.rows.length > 0 : false;
    }

    async loaderCustomDelete(key: string): Promise<void> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        this.debug(`custom delete '${key}'`);
        const results = await this.connection.execute(
            `DELETE FROM ${this.loadersCustomDataTableName} WHERE key = '${key}'`,
        );
        this.debug(`custom delete for key '${key}' resulted in`, results.rowsAffected);
    }

    async deleteLoaderMetadataAndCustomValues(loaderId: string): Promise<void> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        this.debug(`LibSQL deleteLoaderMetadataAndCustomValues for loader '${loaderId}'`);
        await this.connection.execute(`DELETE FROM ${this.loadersTableName} WHERE id = '${loaderId}'`);
        await this.connection.execute(`DELETE FROM ${this.loadersCustomDataTableName} WHERE loaderId = '${loaderId}'`);
    }

    async getConversation(conversationId: string): Promise<Conversation> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        const results = await this.connection.execute(
            `SELECT id, conversationId, content, timestamp, actor, sources FROM ${this.conversationsTableName} WHERE conversationId = :1`,
            [conversationId],
        );

        return {
            conversationId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            entries: results.rows ? results.rows.map((result: any) => {
                const timestamp = new Date(result[3].toString());
                const actor = result[4].toString();

                if (actor === 'AI') {
                    return {
                        actor: 'AI',
                        id: result[0].toString(),
                        content: result[2].toString(),
                        sources: JSON.parse(result[5].toString()),
                        timestamp,
                    };
                } else {
                    return {
                        id: result[0].toString(),
                        content: result[2].toString(),
                        actor: <'HUMAN' | 'SYSTEM'>actor,
                        timestamp,
                    };
                }
            }) : [],
        };
    }

    async hasConversation(conversationId: string): Promise<boolean> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        const results = await this.connection.execute(
            `SELECT id, conversationId, content, timestamp, actor FROM ${this.conversationsTableName} WHERE conversationId = :1 FETCH FIRST 1 ROWS ONLY`,
            [conversationId],
        );

        return results.rows ? results.rows.length > 0 : false;
    }

    async deleteConversation(conversationId: string): Promise<void> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        await this.connection.execute(
            `DELETE FROM ${this.conversationsTableName} WHERE conversationId = '${conversationId}'`,
        );
    }

    async addEntryToConversation(conversationId: string, entry: Message): Promise<void> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        if (entry.actor !== 'AI') {
            await this.connection.execute(`INSERT INTO ${this.conversationsTableName} (id, conversationId, content, timestamp, actor)
                VALUES (:1, :2, :3,:4, :5)`,
                [entry.id, conversationId, entry.content, entry.timestamp, entry.actor]);
        } else {
            await this.connection.execute(
                `INSERT INTO ${this.conversationsTableName} (id, conversationId, content, timestamp, actor, sources)
                VALUES (:1, :2, :3,:4, :5, :6)`,
                [
                    entry.id,
                    conversationId,
                    entry.content,
                    entry.timestamp,
                    entry.actor,
                    JSON.stringify(entry.sources),
                ]
            );
        }
    }

    async clearConversations(): Promise<void> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }
        await this.connection.execute(`DELETE FROM ${this.conversationsTableName}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async addConversation(_conversationId: string): Promise<void> {
        //There is nothing to be done for this in this libsql implementation
    }

    async closeConnection() {
        if (this.connection) {
            await this.connection.close()
        }
    }
}