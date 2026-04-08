package logminer;

/**
 * An immutable record returned by each LogFileTask upon completion.
 * Do not modify this file.
 */
public record FileTaskResult(String fileName, int linesRead, int invalidLines) {}
