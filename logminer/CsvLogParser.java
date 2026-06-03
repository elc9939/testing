package logminer;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Parses a single CSV line into a LogRecord.
 * The expected CSV format:
 *   timestamp,userId,action,bytes,status
 *
 * Fields may be quoted with double quotes. Inside quoted fields, a literal quote
 * is written as two double quotes.
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
        if (line == null) {
            throw new LogParseException("null line");
        }
        line = line.trim();
        if (line.isEmpty()) throw new LogParseException("empty line");
        String[] parts = splitCsv(line);
        if (parts.length != 5) {
            throw new LogParseException("expected 5 fields, got " + parts.length);
        }

        for (int i = 0; i < parts.length; i++) {
            parts[i] = parts[i].trim();
        }
        if (parts[0].isEmpty()) throw new LogParseException("timestamp empty");
        if (parts[1].isEmpty()) throw new LogParseException("userId empty");

        String rawAction = parts[2];
        LogRecord.Action action;
        try {
            action = LogRecord.Action.valueOf(rawAction.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new LogParseException("unknown action: " + rawAction);
        }

        String rawBytes = parts[3];
        int bytes;
        try {
            bytes = Integer.parseInt(rawBytes);
        } catch (NumberFormatException e) {
            throw new LogParseException("bytes not an int: " + rawBytes);
        }
        if (bytes < 0) {throw new LogParseException("bytes must be non-negative: " + bytes);}

        String rawStatus = parts[4];
        int status;
        try {
            status = Integer.parseInt(rawStatus);
        } catch (NumberFormatException e) {
            throw new LogParseException("status not an int: " + rawStatus);
        }

        return new LogRecord(parts[0], parts[1], action, bytes, status);
    }

    private static String[] splitCsv(String line) throws LogParseException {
        List<String> fields = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean inQuotes = false;
        boolean afterQuote = false;

        for (int i = 0; i < line.length(); i++) {
            char ch = line.charAt(i);

            if (inQuotes) {
                if (ch == '"') {
                    if (i + 1 < line.length() && line.charAt(i + 1) == '"') {
                        field.append('"');
                        i++;
                    } else {
                        inQuotes = false;
                        afterQuote = true;
                    }
                } else {
                    field.append(ch);
                }
                continue;
            }

            if (afterQuote) {
                if (ch == ',') {
                    fields.add(field.toString());
                    field.setLength(0);
                    afterQuote = false;
                } else if (!Character.isWhitespace(ch)) {
                    throw new LogParseException("unexpected character after closing quote");
                }
                continue;
            }

            if (ch == ',') {
                fields.add(field.toString());
                field.setLength(0);
            } else if (ch == '"' && field.toString().trim().isEmpty()) {
                field.setLength(0);
                inQuotes = true;
            } else {
                field.append(ch);
            }
        }

        if (inQuotes) {
            throw new LogParseException("unterminated quoted field");
        }
        fields.add(field.toString());
        return fields.toArray(String[]::new);
    }
}
