export interface InteractiveChild {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  stdin: {
    write(data: string | ArrayBufferView | ArrayBuffer): number;
    flush(): number | Promise<number>;
  };
  exited: Promise<number>;
}

export function spawnInteractive(command: string[]): InteractiveChild {
  return Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  }) as unknown as InteractiveChild;
}
