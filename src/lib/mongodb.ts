import { MongoClient } from 'mongodb';
import { attachDatabasePool } from '@vercel/functions';

const uri = process.env.MONGODB_URI;
const options = {};

let client: MongoClient;
let clientPromise: Promise<MongoClient> | null = null;

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

export const isMongoDbConfigured = (): boolean => {
  return Boolean(uri && uri.startsWith('mongodb'));
};

export async function getMongoClientPromise(): Promise<MongoClient | null> {
  if (!isMongoDbConfigured() || !uri) {
    return null;
  }

  if (process.env.NODE_ENV === 'development') {
    // In development mode, use a global variable so that the value
    // is preserved across module reloads caused by HMR.
    if (!global._mongoClientPromise) {
      client = new MongoClient(uri, options);
      try {
        attachDatabasePool(client);
      } catch (e) {
        // attachDatabasePool is used in Vercel functions environment
      }
      global._mongoClientPromise = client.connect();
    }
    clientPromise = global._mongoClientPromise;
  } else {
    // In production mode, it's best to not use a global variable.
    if (!clientPromise) {
      client = new MongoClient(uri, options);
      try {
        attachDatabasePool(client);
      } catch (e) {
        // attachDatabasePool is used in Vercel functions environment
      }
      clientPromise = client.connect();
    }
  }

  return clientPromise;
}

export async function getMongoDb() {
  const connectedClient = await getMongoClientPromise();
  if (!connectedClient) return null;
  return connectedClient.db('email_priority_system');
}
