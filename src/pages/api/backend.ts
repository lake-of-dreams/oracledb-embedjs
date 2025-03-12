import type { NextApiRequest, NextApiResponse } from 'next'
import { PassThrough } from 'stream';
import * as compose from 'docker-compose'
import path from 'path';
import { env } from 'process';
import * as formidable from 'formidable';
import { RAGApplicationBuilder } from '@llm-tools/embedjs';
import { WebLoader } from '@llm-tools/embedjs-loader-web';
import { OracleDb } from '@/app/lib/oracle-db';
import { OracleStore } from '@/app/lib/oracle-store';
import { Ollama, OllamaEmbeddings } from '@llm-tools/embedjs-ollama';
import { SYSDBA } from 'oracledb';

export const config = {
    api: {
        bodyParser: false
    },
}
export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: { fields: any; files: any } = await new Promise(
            (resolve, reject) => {
                const form = new formidable.IncomingForm();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                form.parse(req, (err: any, fields: any, files: any) => {
                    if (err) reject({ err });
                    resolve({ fields, files });
                });
            }
        );


        if (!env.config_dir) {
            console.log('config_dir must be specified')
            return
        }
        if (!env.docker_exec) {
            env.docker_exec = "podman"
        }
        process.on('uncaughtException', function (err) {
            if (!ignoreError(err)) {
                console.log(err)
            }
        })
        const encoder = new TextEncoder()
        const stream = new PassThrough()
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.setHeader('Connection', 'keep-alive')
        res.setHeader('Cache-Control', 'no-cache, no-transform')
        res.setHeader('Content-Encoding', 'none')
        stream.pipe(res)
        switch (req.method) {
            case "POST":
                const wait = async function (maxTry: number) {
                    if (env.config_dir && env.docker_exec) {
                        let count = 0;
                        while (count < maxTry) {
                            await compose.execCompose("ps", ["--format", "json", "db"], {
                                cwd: path.join(env.config_dir), executable: { executablePath: env.docker_exec },
                            }).then(
                                (result) => {
                                    if (result.out.startsWith('{')) {
                                        const health = JSON.parse(result.out).Health;
                                        if (health == "healthy") {
                                            reply("DB and Ollama started", undefined, stream, encoder, res, false, true, true, 200)
                                            count = maxTry
                                        } else {
                                            reply("DB Starting..", undefined, stream, encoder, res, false, true, false, undefined)
                                            count++
                                        }
                                    }
                                },
                                (err) => {
                                    reply("DB and Ollama start failed 1", err, stream, encoder, res, true, true, true, 500)
                                    count = maxTry
                                }
                            ).catch((err) => {
                                reply("DB and Ollama start failed 2", err, stream, encoder, res, true, true, true, 500)
                                count = maxTry
                            })
                            await sleep(3000)
                        }
                    } else {
                        throw new Error("invalid config")
                    }
                }
                const up = compose.upAll({
                    cwd: path.join(env.config_dir), log: true, executable: { executablePath: env.docker_exec }, callback: (chunk: Buffer) => {
                        stream.write(encoder.encode(chunk.toString()))
                    }
                }
                ).then(
                    () => {
                        reply('DB startup in progress..', undefined, stream, encoder, res, false, true, false, undefined)
                    },
                    (err) => {
                        reply("DB and Ollama start failed 3", err, stream, encoder, res, true, true, true, 500)
                    }
                ).catch((err) => {
                    reply("DB and Ollama start failed 4", err, stream, encoder, res, true, true, true, 500)
                })
                await wait(1)
                await Promise.all([up, compose.logs(["db", "ollama"], {
                    follow: true, cwd: path.join(env.config_dir), log: true, executable: { executablePath: env.docker_exec }, callback: (chunk: Buffer) => {
                        stream.write(encoder.encode(chunk.toString()))
                    }
                }), wait(20)])
                break;
            case "DELETE":
                const down = compose.downAll({
                    cwd: path.join(env.config_dir), log: true, executable: { executablePath: env.docker_exec }, callback: (chunk: Buffer) => {
                        stream.write(encoder.encode(chunk.toString()))
                    }
                }).then(
                    () => {
                        reply("DB and Ollama stopped", undefined, stream, encoder, res, false, true, true, 200)
                    },
                    (err) => {
                        reply("DB and Ollama stop failed", err, stream, encoder, res, true, true, true, 500)
                    }
                ).catch((err) => {
                    reply("DB and Ollama stop failed", err, stream, encoder, res, true, true, true, 500)
                })
                await Promise.all([down, compose.logs(["db", "ollama"], {
                    follow: true, cwd: path.join(env.config_dir), log: true, executable: { executablePath: env.docker_exec }, callback: (chunk: Buffer) => {
                        stream.write(encoder.encode(chunk.toString()))
                    }
                })])
                break;
            case "PUT":
                try {
                    stream.write(encoder.encode(`Processing model: ${data.fields.modelName[0]}.. \n`))
                    const dbConfig = {
                        user: "SYS",
                        password: "oracle",
                        connectString: "0.0.0.0:1521/FREEPDB1",
                        privilege: SYSDBA
                    };
                    await compose.exec("ollama", ["ollama", "pull", data.fields.modelName[0]], {
                        cwd: path.join(env.config_dir), log: true, executable: { executablePath: env.docker_exec }, callback: (chunk: Buffer) => {
                            stream.write(encoder.encode(chunk.toString()))
                        }
                    })
                    compose.exec("ollama", ["ollama", "run", data.fields.modelName[0], "--keepalive", "10m", ">>", "/dev/null"], {
                        cwd: path.join(env.config_dir), log: true, executable: { executablePath: env.docker_exec }, callback: (chunk: Buffer) => {
                            stream.write(encoder.encode(chunk.toString()))
                        }
                    })
                    reply('Building RAG Application.\n', undefined, stream, encoder, res, false, true, false, undefined)
                    const store = new OracleStore({ dbConfig: dbConfig })
                    const vectordb = new OracleDb({ dbConfig, tableName: "vectorTab" })
                    const app = await new RAGApplicationBuilder()
                        .setStore(store)
                        .setVectorDatabase(vectordb)
                        .setEmbeddingModel(new OllamaEmbeddings({
                            model: data.fields.modelName[0],
                            baseUrl: 'http://localhost:11434'
                        }))
                        .setModel(new Ollama({ temperature: 0.0, modelName: data.fields.modelName[0], baseUrl: 'http://localhost:11434' }))
                        .build();


                    reply('RAG Application initialized.\n', undefined, stream, encoder, res, false, true, false, undefined)
                    reply(`Loading data from ${data.fields.webUrl[0]}.`, undefined, stream, encoder, res, false, true, false, undefined)
                    await app.addLoader(new WebLoader({ urlOrContent: data.fields.webUrl[0] }));
                    reply(`Data loaded from ${data.fields.webUrl[0]}.\n`, undefined, stream, encoder, res, false, true, false, undefined)
                    reply(`Asking query: ${data.fields.query[0]}.\n`, undefined, stream, encoder, res, false, true, false, undefined)
                    const response = await app.query(data.fields.query[0]);
                    reply(`Response received for query.\n`, response.content, stream, encoder, res, false, false, false, undefined)
                    stream.write(encoder.encode(response.content))
                    await compose.exec("ollama", ["ollama", "stop", data.fields.modelName[0]], {
                        cwd: path.join(env.config_dir), log: true, executable: { executablePath: env.docker_exec }
                    })
                    await store.closeConnection()
                    await vectordb.closeConnection()
                    stream.end()
                } catch (err) {
                    console.log(err)
                    await compose.exec("ollama", ["ollama", "stop", data.fields.modelName[0]], {
                        cwd: path.join(env.config_dir), log: true, executable: { executablePath: env.docker_exec }
                    })
                    res.status(500).json({ "message": "failed" })
                } finally {

                }

                break;
            default:
                break;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
        if (!ignoreError(err)) {
            if (err.cause == 401) {
                res.status(401).json({ "message": err.message })
            }
            res.status(500).json(err.body?.message ? err.body?.message : err.message)
        }

    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ignoreError(err: any): boolean {
    if ((err.errno == -2 && err.path == "docker" && env.docker_exec !== "docker") || (err.exitCode == 0)) {
        return true
    }
    return false

}

function sleep(ms: number | undefined) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reply(msg: string, err: any, stream: any, encoder: any, res: any, destroyStream: boolean, writeToStream: boolean, commitResponse: boolean, responseCode: number | undefined) {
    if (msg) {
        console.log(msg)
    }

    if (err && !ignoreError(err)) {
        console.log(err)
    }
    if (writeToStream) {
        stream.write(encoder.encode(msg));
    }
    if (destroyStream) {
        stream.destroy(new Error(msg))
    }
    if (commitResponse) {
        res.status(responseCode).json({ "message": msg })
    }

}