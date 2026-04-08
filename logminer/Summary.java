package logminer;

import java.util.List;
import java.util.Map;

/**
 * An immutable record holding the final aggregated summary data
 * used to produce all output files (JSON, CSV, binary).
 * Do not modify this file.
 */
public record Summary(
        String inputDir,
        int threads,
        long validEvents,
        long invalidLines,
        long totalBytes,
        Map<String, Long> byAction,
        Map<String, Long> byStatus,
        List<UserSummary> perUser,
        List<UserBytes> topUsersByBytes
) {
    public record UserSummary(String userId, long events, long bytes) {}
    public record UserBytes(String userId, long bytes) {}
}
