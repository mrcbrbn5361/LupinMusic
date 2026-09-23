declare module 'discord-rpc' {
  export class Client {
    constructor(options: { transport: string });
    on(event: string, callback: (...args: any[]) => void): this;
    login(options: { clientId: string }): Promise<this>;
    setActivity(activity: any): Promise<any>;
    clearActivity(): Promise<any>;
    destroy(): Promise<void>;
  }
}
