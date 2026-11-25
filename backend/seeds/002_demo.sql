INSERT INTO products (sku, name, price, stock) VALUES
    ('KOP-AR250', 'Kopi Arabika Bubuk 250 g', 65000, 40),
    ('KOP-RB250', 'Kopi Robusta Bubuk 250 g', 42000, 35),
    ('TEH-HJ100', 'Teh Hijau 100 g', 28000, 24),
    ('TEH-HT100', 'Teh Hitam 100 g', 22000, 30),
    ('GUL-PS1KG', 'Gula Pasir 1 kg', 18500, 60),
    ('BER-PR5KG', 'Beras Premium 5 kg', 78000, 20),
    ('MIN-SW1LT', 'Minyak Goreng Sawit 1 L', 21000, 45),
    ('SUS-UH1LT', 'Susu UHT Full Cream 1 L', 19500, 32),
    ('MIE-GR085', 'Mi Instan Goreng 85 g', 3500, 120),
    ('AIR-MN600', 'Air Mineral 600 ml', 4000, 96),
    ('BIS-KL300', 'Biskuit Kelapa 300 g', 17000, 8),
    ('MAD-MR250', 'Madu Murni 250 ml', 55000, 6)
ON CONFLICT (sku) DO NOTHING;
