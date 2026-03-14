declare module "@across-protocol/app-sdk" {
  type AcrossClient = {
    getAvailableRoutes(input: any): Promise<any[]>;
    getQuote(input: any): Promise<any>;
    executeQuote(input: any): Promise<any>;
  };

  export function createAcrossClient(input: {
    integratorId?: string;
    chains: any[];
    useTestnet?: boolean;
  }): AcrossClient;
}
