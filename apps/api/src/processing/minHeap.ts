/** A binary min-heap of (cost, value) pairs on typed arrays; equal costs pop in insertion order. */
export class MinHeap {
  #costs = new Float64Array(256);
  #values = new Int32Array(256);
  #order = new Float64Array(256);
  #size = 0;
  #counter = 0;

  get size(): number {
    return this.#size;
  }

  clear(): void {
    this.#size = 0;
    this.#counter = 0;
  }

  push(cost: number, value: number): void {
    if (this.#size === this.#costs.length) this.#grow();
    let index = this.#size;
    this.#size += 1;
    const order = this.#counter;
    this.#counter += 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.#before(cost, order, parent)) break;
      this.#costs[index] = this.#costs[parent] ?? 0;
      this.#values[index] = this.#values[parent] ?? 0;
      this.#order[index] = this.#order[parent] ?? 0;
      index = parent;
    }
    this.#costs[index] = cost;
    this.#values[index] = value;
    this.#order[index] = order;
  }

  /** Cost of the smallest entry (Infinity when empty). */
  peekCost(): number {
    return this.#size === 0 ? Number.POSITIVE_INFINITY : (this.#costs[0] ?? 0);
  }

  /** Removes the smallest entry and returns its value (-1 when empty). */
  pop(): number {
    if (this.#size === 0) return -1;
    const top = this.#values[0] ?? -1;
    this.#size -= 1;
    const cost = this.#costs[this.#size] ?? 0;
    const value = this.#values[this.#size] ?? 0;
    const order = this.#order[this.#size] ?? 0;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      if (left >= this.#size) break;
      const right = left + 1;
      const child =
        right < this.#size && this.#before(this.#costs[right] ?? 0, this.#order[right] ?? 0, left)
          ? right
          : left;
      if (!this.#before(this.#costs[child] ?? 0, this.#order[child] ?? 0, index, cost, order))
        break;
      this.#costs[index] = this.#costs[child] ?? 0;
      this.#values[index] = this.#values[child] ?? 0;
      this.#order[index] = this.#order[child] ?? 0;
      index = child;
    }
    this.#costs[index] = cost;
    this.#values[index] = value;
    this.#order[index] = order;
    return top;
  }

  /** Whether (cost, order) sorts before the entry at `index`, or before (otherCost, otherOrder). */
  #before(
    cost: number,
    order: number,
    index: number,
    otherCost?: number,
    otherOrder?: number,
  ): boolean {
    const against = otherCost ?? this.#costs[index] ?? 0;
    const againstOrder = otherOrder ?? this.#order[index] ?? 0;
    return cost < against || (cost === against && order < againstOrder);
  }

  #grow(): void {
    const size = this.#costs.length * 2;
    const costs = new Float64Array(size);
    costs.set(this.#costs);
    const values = new Int32Array(size);
    values.set(this.#values);
    const order = new Float64Array(size);
    order.set(this.#order);
    this.#costs = costs;
    this.#values = values;
    this.#order = order;
  }
}
