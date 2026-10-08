/** @file Adds the Firebase React Native persistence export missing from the SDK's browser-oriented TypeScript entrypoint. */
import 'firebase/auth';
import { type Persistence } from 'firebase/auth';
declare module 'firebase/auth' {
  /** Wrap asynchronous native storage using Firebase's supported React Native runtime export. */
  export function getReactNativePersistence(storage: {
    /** Read a persisted Firebase value. */
    getItem(key: string): Promise<string | null>;
    /** Persist a Firebase value. */
    setItem(key: string, value: string): Promise<void>;
    /** Remove persisted Firebase state. */
    removeItem(key: string): Promise<void>;
  }): Persistence;
}
