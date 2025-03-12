import createDebugMessages from 'debug';

import { BaseVectorDatabase, ExtractChunkData, InsertChunkData } from '@llm-tools/embedjs-interfaces';
import { truncateCenterString } from '@llm-tools/embedjs-utils';
import { Connection, getConnection } from 'oracledb';

export type DbConfig = {
    user: string,
    password: string,
    connectString: string
};

export class OracleDb implements BaseVectorDatabase {
    private readonly debug = createDebugMessages('embedjs:vector:OracleDb');
    private readonly tableName: string;
    private readonly dbConfig: DbConfig;
    private connection: Connection | undefined;

    constructor({ dbConfig, tableName }: { dbConfig: DbConfig; tableName?: string }) {
        this.tableName = tableName ?? 'vectors';
        this.dbConfig = dbConfig;
    }

    async init({ dimensions }: { dimensions: number }) {
        this.connection = await getConnection(this.dbConfig);
        await this.connection.execute(`drop table if exists ${this.tableName}`);
        const sql = `CREATE TABLE ${this.tableName} (id              VARCHAR2(400) PRIMARY KEY,
            pageContent     VARCHAR2(4000),
            uniqueLoaderId  VARCHAR2(400) NOT NULL,
            source          VARCHAR2(400) NOT NULL,
            vector          VECTOR(${dimensions}, FLOAT32),
            metadata        VARCHAR2(4000)
        )`
        await this.connection.execute(sql);
    }

    async insertChunks(chunks: InsertChunkData[]): Promise<number> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        const sql = `INSERT INTO ${this.tableName} (id, pageContent, uniqueLoaderId, source, vector, metadata)
            VALUES (:1, :2, :3, :4, :5, :6)`
        const batch = chunks.map((chunk) => {
            return [
                chunk.metadata.id,
                chunk.pageContent,
                chunk.metadata.uniqueLoaderId,
                chunk.metadata.source,
                new Float32Array(chunk.vector),
                JSON.stringify(chunk.metadata),
            ]

        });

        this.debug(`Executing batch - ${truncateCenterString(JSON.stringify(batch), 1000)}`);
        const result = await this.connection.executeMany(sql, batch);
        return result.rowsAffected ? result.rowsAffected : 0;
    }

    async similaritySearch(query: number[], k: number): Promise<ExtractChunkData[]> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        const statement = `SELECT id, pageContent, uniqueLoaderId, source, metadata,
                VECTOR_DISTANCE(vector, :1, COSINE) as distance
            FROM ${this.tableName}
            ORDER BY VECTOR_DISTANCE(vector, :2, COSINE) ASC
            FETCH FIRST ${k} ROWS ONLY`;

        this.debug(`Executing statement - ${truncateCenterString(statement, 700)}`);
        const embedValue = new Float32Array(query)
        const results = await this.connection.execute(statement, [embedValue, embedValue]);
        if (results.rows) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return results.rows.map((result: any) => {
                const metadata = result[5] ? JSON.parse(result[4].toString()) : {};

                return {
                    metadata,
                    pageContent: result[1].toString(),
                    score: Math.abs(1 - <number>result[5]),
                };
            });
        }
        return []

    }

    async getVectorCount(): Promise<number> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        const statement = `SELECT count(id) as count FROM ${this.tableName}`;
        this.debug(`Executing statement - ${statement}`);
        const results = await this.connection.execute(statement);
        if (results.rows && results.rows[0]) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return Number.parseInt((results.rows[0] as any).count.toString());
        }
        return 0
    }

    async deleteKeys(uniqueLoaderId: string): Promise<boolean> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        await this.connection.execute(`DELETE FROM ${this.tableName} WHERE
           uniqueLoaderId = '${uniqueLoaderId}'`);
        return true;
    }

    async reset(): Promise<void> {
        if (!this.connection) {
            throw new Error('connection not initialized')
        }

        await this.connection.execute(`DELETE FROM ${this.tableName}`);
    }

    async closeConnection() {
        if (this.connection) {
            await this.connection.close()
        }
    }
}