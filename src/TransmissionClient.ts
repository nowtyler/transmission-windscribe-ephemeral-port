import axios, {type AxiosInstance} from 'axios';

/**
 * Client for Transmission's RPC API.
 * Handles session ID negotiation, authentication, and port management.
 * @see https://github.com/transmission/transmission/blob/main/docs/rpc-spec.md
 */
export class TransmissionClient {

  private api: AxiosInstance;
  private sessionId: string = '';

  constructor(
    url: string,
    username: string,
    password: string,
  ) {
    this.api = axios.create({
      baseURL: url.replace(/\/$/, ''),
      auth: {username, password},
      headers: {'Content-Type': 'application/json'},
    });
  }

  /**
   * Send a JSON-RPC request to Transmission.
   * Automatically handles the CSRF session ID handshake — Transmission requires
   * an `X-Transmission-Session-Id` header on every request, and responds with a
   * 409 containing the valid session ID when one is missing or expired.
   */
  private async rpc(method: string, arguments_?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body = {method, ...(arguments_ ? {arguments: arguments_} : {})};

    try {
      const response = await this.api.post('/transmission/rpc', body, {
        headers: {'X-Transmission-Session-Id': this.sessionId},
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        // Grab the new session ID from the 409 response and retry
        this.sessionId = error.response.headers['x-transmission-session-id'];
        const response = await this.api.post('/transmission/rpc', body, {
          headers: {'X-Transmission-Session-Id': this.sessionId},
        });
        return response.data;
      }
      throw error;
    }
  }

  /** Verify connectivity and log the Transmission version. */
  async updateConnection(): Promise<{version: string}> {
    const data = await this.rpc('session-get', {fields: ['version', 'rpc-version']});
    const args = data.arguments as Record<string, unknown>;

    if (!args?.version) {
      throw new Error('Failed to connect to Transmission');
    }

    const version = args.version as string;
    console.log(`Connected to Transmission ${version} (RPC v${args['rpc-version']})`);

    return {version};
  }

  /** Get the current peer listening port from Transmission's session. */
  async getPort(): Promise<number> {
    await this.updateConnection();

    const data = await this.rpc('session-get', {fields: ['peer-port']});
    const args = data.arguments as Record<string, number>;

    return args['peer-port'];
  }

  /** Set a new peer listening port and disable random port on startup. */
  async updatePort(port: number): Promise<void> {
    await this.updateConnection();

    await this.rpc('session-set', {
      'peer-port': port,
      'peer-port-random-on-start': false,
    });

    console.log('Client port update requested.');
  }

}
