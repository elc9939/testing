package logminer;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAdder;

/**
 * Thread-safe aggregator that accumulates statistics from multiple log files
 * being processed concurrently.
 *
 * Thread-safety strategy:
 *   - Global counters use LongAdder (scalable under contention).
 *   - Per-action, per-status, and per-user maps use ConcurrentHashMap.
 *   - All mutations happen through thread-safe operations (computeIfAbsent + LongAdder).
 */
public final class ConcurrentStatsAggregator {

    // TODO: Declare three private final LongAdder fields:
    //   - validEvents
    //   - invalidLines
    //   - totalBytes
    private final LongAdder validEvents;
    private final LongAdder invalidLines;
    private final LongAdder totalBytes;

    // TODO: Declare three private final ConcurrentHashMap fields:
    //   - byAction:  ConcurrentHashMap<LogRecord.Action, LongAdder>
    //   - byStatus:  ConcurrentHashMap<Integer, LongAdder>
    //   - byUser:    ConcurrentHashMap<String, UserStats>

    private final ConcurrentHashMap<LogRecord.Action, LongAdder> byAction;
    private final ConcurrentHashMap<Integer, LongAdder> byStatus;
    private final ConcurrentHashMap<String, UserStats> byUser;

    public ConcurrentStatsAggregator() {
        validEvents = new LongAdder();
        invalidLines = new LongAdder();
        totalBytes = new LongAdder();

        byAction = new ConcurrentHashMap<>();
        byStatus = new ConcurrentHashMap<>();
        byUser = new ConcurrentHashMap<>();
    }
    /**
     * Records a valid log event. Called concurrently from multiple threads.
     * Must be thread-safe.
     */
    public void recordValid(LogRecord r) {
        // TODO: Increment validEvents.
        // TODO: Add r.bytes() to totalBytes.
        validEvents.increment();
        totalBytes.add(r.bytes());

        // TODO: Use computeIfAbsent on byAction to get or create a LongAdder, then increment it.
        // TODO: Use computeIfAbsent on byStatus to get or create a LongAdder, then increment it.
        byAction.computeIfAbsent(r.action(), k -> new LongAdder()).increment();
        byStatus.computeIfAbsent(r.status(), k -> new LongAdder()).increment();

        // TODO: Use computeIfAbsent on byUser to get or create a UserStats, then call record(r) on it.
        byUser.computeIfAbsent(r.userId(), k -> new UserStats()).record(r);
    }

    /**
     * Records that one invalid line was encountered. Called concurrently.
     */
    public void recordInvalid() {
        // TODO: Increment invalidLines.
        invalidLines.increment();
    }

    /**
     * Produces a deterministic Summary snapshot from the accumulated data.
     * Called after all tasks have completed (single-threaded at this point).
     */
    public Summary toSummary(CliConfig cfg) {
        // TODO: Build a TreeMap<String, Summary.UserSummary> from byUser (sorted by userId).
        TreeMap<String, Summary.UserSummary> perUser = new TreeMap<>();
        for (Map.Entry<String, UserStats> entry : byUser.entrySet()) {
            perUser.put(entry.getKey(), entry.getValue().toUserSummary(entry.getKey()));
        }
        // TODO: Build a TreeMap<String, Long> for actions.
        //       Iterate over all LogRecord.Action values.
        //       Use getOrDefault to handle actions with zero count.
        TreeMap<String, Long> perAction = new TreeMap<>();
        for (LogRecord.Action action : LogRecord.Action.values()) {
            perAction.put(action.name(), byAction.getOrDefault(action, new LongAdder()).sum());
        }
        // TODO: Build a TreeMap<String, Long> for statuses (key = Integer.toString(statusCode)).
        TreeMap<String, Long> perStatus = new TreeMap<>();
        for (Map.Entry<Integer, LongAdder> entry : byStatus.entrySet()) {
            perStatus.put(Integer.toString(entry.getKey()), entry.getValue().sum());
        }
        // TODO: Build topUsersByBytes:
        //       Stream the user summaries, map to Summary.UserBytes,
        //       sort by bytes descending (then userId ascending for ties),
        //       limit to cfg.topUsers().
        List<Summary.UserSummary> perUserList = new ArrayList<>(perUser.values());
        List<Summary.UserBytes> topUsersByBytes = perUser.values().stream()
                .map(u -> new Summary.UserBytes(u.userId(), u.bytes()))
                .sorted(
                        Comparator.comparingLong(Summary.UserBytes::bytes).reversed()
                                .thenComparing(Summary.UserBytes::userId)
                )
                .limit(cfg.topUsers())
                .toList();

        // TODO: Return a new Summary with all the assembled data.
        return new Summary(
                cfg.inputDir().toString(),
                cfg.threads(),
                validEvents.sum(),
                invalidLines.sum(),
                totalBytes.sum(),
                perAction,
                perStatus,
                perUserList,
                topUsersByBytes
        );
        //return null; // Placeholder
    }

    /**
     * Inner class for per-user statistics. Uses LongAdder for thread-safe updates.
     */
    private static final class UserStats {
        private final LongAdder events = new LongAdder();
        private final LongAdder bytes = new LongAdder();

        void record(LogRecord r) {
            events.increment();
            bytes.add(r.bytes());
        }

        Summary.UserSummary toUserSummary(String userId) {
            return new Summary.UserSummary(userId, events.sum(), bytes.sum());
        }
    }
}
