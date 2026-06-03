package logminer;

import java.util.Locale;

/**
 * Parses a single CSV line into a LogRecord.
 * The expected CSV format (no quoted fields):
 *   timestamp,userId,action,bytes,status
 */
public final class CsvLogParser {
    private CsvLogParser() {}

    public static final String REQUIRED_HEADER = "timestamp,userId,action,bytes,status";

    /**
     * Parses a single CSV data line into a LogRecord.
     *
     * @param line the raw CSV line (not a header)
     * @return a valid LogRecord
     * @throws LogParseException if the line is invalid
     */
    public static LogRecord parseLine(String line) throws LogParseException {
        // TODO: If line is null, throw LogParseException with message "null line".
        // TODO: Trim whitespace. If the trimmed line is empty, throw LogParseException with "empty line".
        if (line == null) {throw new LogParseException("null line");}
        line = line.trim();
        if (line.isEmpty()) throw new LogParseException("empty line");
        // TODO: Split the line by comma using split(",", -1).
        // TODO: If the number of fields is not 5, throw LogParseException:
        //       "expected 5 fields, got " + actual count.
        String[] parts = line.split(",", -1);
        if(parts.length != 5){
            throw new LogParseException("expected 5 fields, got " + parts.length);
        }

        // TODO: Trim each field. Validate:
        //   - timestamp must not be empty ("timestamp empty")
        //   - userId must not be empty ("userId empty")
        for (int i=0; i<parts.length; i++){
            parts[i] = parts[i].trim();
        }
        if (parts[0].isEmpty()) throw new LogParseException("timestamp empty");
        if (parts[1].isEmpty()) throw new LogParseException("userId empty");


        // TODO: Parse the action field (uppercase it first).
        //       Use LogRecord.Action.valueOf(). If it fails (IllegalArgumentException),
        //       throw LogParseException: "unknown action: " + raw value.
        String rawAction = parts[2];
        LogRecord.Action action;
        try {
            action = LogRecord.Action.valueOf(rawAction.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new LogParseException("unknown action: " + rawAction);
        }

        // TODO: Parse bytes as an integer.
        //       Catch NumberFormatException and rethrow as LogParseException: "bytes not an int: " + raw.
        //       If bytes < 0, throw LogParseException: "bytes must be non-negative: " + value.
        String rawBytes = parts[3];
        int bytes;
        try {
            bytes = Integer.parseInt(rawBytes);
        } catch (NumberFormatException e) {
            throw new LogParseException("bytes not an int: " + rawBytes);
        }
        if (bytes < 0) {throw new LogParseException("bytes must be non-negative: " + bytes);}
        // TODO: Parse status as an integer.
        //       Catch NumberFormatException and rethrow as LogParseException: "status not an int: " + raw.

        // TODO: Return a new LogRecord with the parsed values.
        String rawStatus = parts[4];
        int status;
        try {
            status = Integer.parseInt(rawStatus);
        } catch (NumberFormatException e) {
            throw new LogParseException("status not an int: " + rawStatus);
        }


        return  new LogRecord(parts[0], parts[1], action, bytes, status);

        // return null; // Placeholder
    }
}
