package logminer;

/**
 * An immutable record representing a single parsed log event.
 * Do not modify this file.
 */
public record LogRecord(String timestamp, String userId, Action action, int bytes, int status) {
    public enum Action { LOGIN, LOGOUT, UPLOAD, DOWNLOAD }
}
