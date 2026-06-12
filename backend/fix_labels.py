import sys; sys.path.insert(0, '.')
from database import engine
from sqlalchemy import text
with engine.connect() as conn:
    conn.execute(text("UPDATE import_sources SET custom_label = NULL WHERE custom_label IN ('None', '')"))
    conn.commit()
    rows = conn.execute(text('SELECT id, default_label, custom_label FROM import_sources')).fetchall()
    for r in rows:
        print(dict(r._mapping))
