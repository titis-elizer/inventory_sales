-- Executed inside setup's transaction and advisory lock. Marker prevents replay.
CREATE TABLE IF NOT EXISTS seed_runs (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE
    first_order INTEGER;
    second_order INTEGER;
    coffee products%ROWTYPE;
    tea products%ROWTYPE;
BEGIN
    IF EXISTS (SELECT 1 FROM seed_runs WHERE name='sample_orders_v1') THEN
        RETURN;
    END IF;
    PERFORM id FROM products WHERE sku IN ('KOP-AR250','TEH-HJ100') ORDER BY id FOR UPDATE;
    SELECT * INTO STRICT coffee FROM products WHERE sku='KOP-AR250';
    SELECT * INTO STRICT tea FROM products WHERE sku='TEH-HJ100';
    IF coffee.stock < 3 OR tea.stock < 1 THEN
        RAISE EXCEPTION 'Insufficient stock for sample order seed; setup rolled back';
    END IF;

    INSERT INTO sales_orders(customer,total) VALUES ('Kedai Pagi', coffee.price::bigint*2+tea.price::bigint)
        RETURNING id INTO first_order;
    INSERT INTO sales_order_items(order_id,sku,qty,unit_price) VALUES
        (first_order,coffee.sku,2,coffee.price),(first_order,tea.sku,1,tea.price);
    UPDATE products SET stock=stock-2 WHERE id=coffee.id;
    UPDATE products SET stock=stock-1 WHERE id=tea.id;
    INSERT INTO stock_movements(product_id,type,qty,note) VALUES
        (coffee.id,'out',2,'Sample order #'||first_order),
        (tea.id,'out',1,'Sample order #'||first_order);

    -- A cancelled example: out and restoring in movements both remain in history.
    INSERT INTO sales_orders(customer,total) VALUES ('Toko Senja',coffee.price) RETURNING id INTO second_order;
    INSERT INTO sales_order_items(order_id,sku,qty,unit_price) VALUES(second_order,coffee.sku,1,coffee.price);
    UPDATE products SET stock=stock-1 WHERE id=coffee.id;
    INSERT INTO stock_movements(product_id,type,qty,note) VALUES(coffee.id,'out',1,'Sample order #'||second_order);
    UPDATE products SET stock=stock+1 WHERE id=coffee.id;
    INSERT INTO stock_movements(product_id,type,qty,note,created_at)
        VALUES(coffee.id,'in',1,'Cancel sample order #'||second_order,clock_timestamp());
    UPDATE sales_orders SET status='CANCELLED',cancelled_at=clock_timestamp() WHERE id=second_order;
    INSERT INTO seed_runs(name) VALUES('sample_orders_v1');
END $$;