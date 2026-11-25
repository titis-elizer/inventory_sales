\set ON_ERROR_STOP on
DO $$
BEGIN
    IF (SELECT count(*) FROM sales_orders) <> 2
        OR (SELECT count(*) FROM sales_order_items) <> 3
        OR (SELECT count(*) FROM stock_movements) <> 4
        OR (SELECT stock FROM products WHERE sku='KOP-AR250') <> 38
        OR (SELECT stock FROM products WHERE sku='TEH-HJ100') <> 23 THEN
        RAISE EXCEPTION 'Unexpected sample order seed state';
    END IF;
    IF EXISTS (SELECT 1 FROM sales_orders o WHERE o.total <> (
        SELECT sum(i.qty::bigint*i.unit_price) FROM sales_order_items i WHERE i.order_id=o.id)) THEN
        RAISE EXCEPTION 'Order total does not match item prices';
    END IF;
    IF (SELECT count(*) FROM sales_orders WHERE status='CANCELLED' AND cancelled_at IS NOT NULL) <> 1 THEN
        RAISE EXCEPTION 'Expected one cancelled sample order';
    END IF;
END $$;
SELECT 'Sample order seed verified' AS result;