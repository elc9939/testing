package logminer;

/**
 * Custom checked exception thrown when a CSV log line cannot be parsed.
 *
 * TODO: Implement this custom exception.
 * 1. Extend Exception (this is a checked exception).
 * 2. Create a constructor that takes a String message.
 * 3. Call super(message) to pass the error description to the parent class.
 */
public final class LogParseException extends Exception {
    // TODO: Implement constructor
    public LogParseException(String message) {
        super(message);
    }
}
