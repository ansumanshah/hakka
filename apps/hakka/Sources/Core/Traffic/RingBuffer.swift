/// A fixed-capacity circular buffer. Appending past `capacity` overwrites the
/// oldest slot in place — no element shifting — which is what makes `append`
/// O(1) rather than the O(n) an array-based "drop first" would cost.
struct RingBuffer<Element> {
    let capacity: Int
    private var storage: [Element?]
    private var head = 0
    private(set) var count = 0

    init(capacity: Int) {
        precondition(capacity > 0, "RingBuffer capacity must be positive")
        self.capacity = capacity
        self.storage = Array(repeating: nil, count: capacity)
    }

    var isFull: Bool { count == capacity }

    /// Appends `element`. Returns the evicted element when the buffer was
    /// already full, so callers can retract its contribution from any
    /// running aggregate before folding in the new one.
    @discardableResult
    mutating func append(_ element: Element) -> Element? {
        let tail = (head + count) % capacity
        var evicted: Element?
        if count == capacity {
            evicted = storage[head]
            head = (head + 1) % capacity
        } else {
            count += 1
        }
        storage[tail] = element
        return evicted
    }

    /// All buffered elements, oldest first.
    var elements: [Element] {
        guard count > 0 else { return [] }
        var result = [Element]()
        result.reserveCapacity(count)
        for offset in 0 ..< count {
            result.append(storage[(head + offset) % capacity]!)
        }
        return result
    }

    mutating func removeAll() {
        storage = Array(repeating: nil, count: capacity)
        head = 0
        count = 0
    }
}

extension RingBuffer: Sendable where Element: Sendable {}
