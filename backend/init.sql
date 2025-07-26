-- Create table for consoles if it doesn't exist
CREATE TABLE IF NOT EXISTS ps5_consoles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE, -- Ensure console names are unique
  booked INTEGER DEFAULT 0, -- Tracks if the console is booked (0 = available, 1 = booked)
  end_time DATETIME DEFAULT NULL, -- Tracks the booking end time
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Timestamp when the console was added
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP -- Timestamp when the console was last updated
);

-- Create table for payments if it doesn't exist
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  console TEXT, -- Name of console being paid for
  minutes INTEGER, -- Number of minutes booked
  method TEXT, -- Payment method
  paid_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Timestamp when payment was made
  FOREIGN KEY (console) REFERENCES ps5_consoles(name) ON DELETE CASCADE -- Maintain referential integrity
);

-- Insert initial console data with unique constraint to avoid duplicates
INSERT OR IGNORE INTO ps5_consoles (name) VALUES
  ('PS5 #1'), ('PS5 #2'), ('PS5 #3'), ('PS5 #4'), ('XBOX - Racing Sim');