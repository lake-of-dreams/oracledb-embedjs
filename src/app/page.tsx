"use client";
import {
  Alert,
  AlertColor,
  Button,
  LinearProgress,
  TextField,
} from "@mui/material";
import { useCallback, useState } from "react";

type State = {
  error?: boolean;
  message?: string;
  severity?: AlertColor;
  progress?: boolean;
  dbStarted?: boolean;
  dbStopped?: boolean;
  webUrl?: string;
  query?: string;
  modelName?: string;
};
export default function Home() {
  const [state, setState] = useState<State>({});
  const execute = useCallback(
    async (op: string) => {
      try {
        const formData = new FormData();
        formData.append("message", op);
        if (state.webUrl && state.query && state.modelName) {
          formData.append("webUrl", state.webUrl);
          formData.append("query", state.query);
          formData.append("modelName", state.modelName);
        }

        const response = await fetch("/api/backend", {
          method: op === "start" ? "POST" : op === "stop" ? "DELETE" : "PUT",
          cache: "no-cache",
          keepalive: true,
          headers: {
            Accept: "text/event-stream",
          },
          body: formData,
        });

        const reader = response.body?.getReader();
        if (!response.ok) {
          setState({
            ...state,
            message: `Failed, error: ${await response.json()}`,
            error: true,
            severity: "error",
            progress: false,
          });
        }
        let msg = "";
        while (true) {
          const result = await reader?.read();
          if (result?.done) {
            msg =
              result?.value &&
              result?.value != null &&
              result?.value != undefined
                ? new TextDecoder().decode(result?.value)
                : op === "start"
                ? "DB started"
                : op === "stop"
                ? "DB stopped"
                : msg;
            if (msg != null) {
              setState({
                ...state,
                error: false,
                severity: "success",
                progress: false,
                dbStarted: op === "start" || op === "query" ? true : false,
                dbStopped: op === "stop" ? true : false,
                message: msg,
              });
            }
            break;
          } else {
            if (
              result?.value &&
              result?.value != null &&
              result?.value != undefined
            ) {
              msg = new TextDecoder().decode(result?.value);
              const error = msg.startsWith("error") || msg.includes("failed");
              setState({
                ...state,
                message: msg,
                error,
                severity: error ? "error" : "info",
                progress: !error,
              });
              if (error) {
                break;
              }
            }
          }
        }
      } catch (error) {
        console.log(error);
        setState({
          ...state,
          message: ` ${
            op === "start" ? "DB start" : op === "stop" ? "DB stop" : "Query"
          } failed`,
          error: true,
          severity: "error",
          progress: false,
        });
      }
    },
    [state]
  );
  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <div className="grid grid-rows-6 grid-cols-2">
          <div className="row-span-1 col-span-2 mx-60 mt-30">
            <Button onClick={() => execute("start")} disabled={state.dbStarted}>
              Start Database
            </Button>
            <Button onClick={() => execute("stop")} disabled={state.dbStopped}>
              Stop Database
            </Button>
          </div>
          <div
            className="row-span-1 col-span-2 w-200"
            hidden={!state.dbStarted}
          >
            <TextField
              required
              label="Web URL"
              variant="outlined"
              name="webUrl"
              id="webUrl"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onChange={(evt: any) => {
                const newState: State = {
                  ...state,
                  webUrl: evt.target.value,
                };
                setState({
                  ...newState,
                  error: false,
                });
              }}
              fullWidth={true}
            ></TextField>
          </div>
          <div
            className="row-span-1 col-span-2 w-200"
            hidden={!state.dbStarted}
          >
            <TextField
              required
              label="Ollama Model Name"
              variant="outlined"
              name="modelName"
              id="modelName"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onChange={(evt: any) => {
                const newState: State = {
                  ...state,
                  modelName: evt.target.value,
                };
                setState({
                  ...newState,
                  error: false,
                });
              }}
              fullWidth={true}
            ></TextField>
          </div>
          <div
            className="row-span-1 col-span-2 w-200"
            hidden={!state.dbStarted}
          >
            <TextField
              required
              label="Query"
              variant="outlined"
              name="query"
              id="query"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onChange={(evt: any) => {
                const newState: State = {
                  ...state,
                  query: evt.target.value,
                };
                setState({
                  ...newState,
                  error: false,
                });
              }}
              fullWidth={true}
            ></TextField>
          </div>
          <div
            className="row-span-1 col-span-2 w-200"
            hidden={!state.dbStarted}
          >
            <Button
              onClick={() => execute("query")}
              disabled={!state.dbStarted}
              hidden={!state.dbStarted}
            >
              Execute search
            </Button>
          </div>

          <div className="row-span-1 col-span-2 w-200 text-balance h-48">
            {state.message ? (
              state.progress ? (
                <>
                  <LinearProgress classes={{ root: "col-span-2" }} />
                  <Alert
                    variant="outlined"
                    severity={state.severity}
                    classes={{
                      outlined: "alertoutlined",
                      root: "col-span-2 text-pretty",
                    }}
                  >
                    {state.message}
                  </Alert>
                </>
              ) : (
                <Alert
                  variant="outlined"
                  severity={state.severity}
                  classes={{
                    outlined: "alertoutlined",
                    root: "col-span-2 text-pretty",
                  }}
                >
                  {state.message}
                </Alert>
              )
            ) : (
              <></>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
