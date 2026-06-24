export type Unsubscriber = () => void;
export type Subscriber<T> = (value: T) => void;
export type Invalidator<T> = (value?: T) => void;
export type Updater<T> = (value: T) => T;

export interface Readable<T> {
  subscribe(run: Subscriber<T>, invalidate?: Invalidator<T>): Unsubscriber;
}

export interface Writable<T> extends Readable<T> {
  set(value: T): void;
  update(updater: Updater<T>): void;
}

function shouldNotify<T>(current: T, next: T): boolean {
  return current !== next || (current !== null && (typeof current === 'object' || typeof current === 'function'));
}

type StoresValues<S extends Readable<any>[]> = {
  [K in keyof S]: S[K] extends Readable<infer T> ? T : never;
};

export function writable<T>(initialValue: T): Writable<T> {
  let value = initialValue;
  const subscribers = new Set<Subscriber<T>>();

  function notify() {
    subscribers.forEach((subscriber) => subscriber(value));
  }

  return {
    subscribe(run) {
      run(value);
      subscribers.add(run);
      return () => {
        subscribers.delete(run);
      };
    },
    set(nextValue) {
      if (!shouldNotify(value, nextValue)) return;
      value = nextValue;
      notify();
    },
    update(updater) {
      this.set(updater(value));
    },
  };
}

export function get<T>(store: Readable<T>): T {
  let value!: T;
  const unsubscribe = store.subscribe((nextValue) => {
    value = nextValue;
  });
  unsubscribe();
  return value;
}

export function derived<A, T>(store: Readable<A>, derive: (value: A) => T): Readable<T>;
export function derived<S extends Readable<any>[], T>(
  stores: [...S],
  derive: (values: StoresValues<S>) => T,
): Readable<T>;
export function derived<T>(
  stores: Readable<any> | readonly Readable<any>[],
  derive: (values: any) => T,
): Readable<T> {
  const storesArray = Array.isArray(stores) ? stores : [stores];

  return {
    subscribe(run) {
      let values = storesArray.map((store) => get(store));
      let initialized = false;

      const emit = () => {
        run(derive(Array.isArray(stores) ? values : values[0]));
      };

      const unsubscribers = storesArray.map((store, index) =>
        store.subscribe((value: any) => {
          values[index] = value;
          if (initialized) emit();
        }),
      );

      initialized = true;
      emit();

      return () => {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
      };
    },
  };
}
