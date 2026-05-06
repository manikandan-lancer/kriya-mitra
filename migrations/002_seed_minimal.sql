-- Minimal seed so the bot can answer "tomato + whitefly" end-to-end.
-- Real product/dosage data must be filled in by Kriya agronomy team.

INSERT INTO crops (slug, name_en, name_local, scientific, category) VALUES
  ('tomato', 'Tomato',
   '{"ta":"தக்காளி","hi":"टमाटर","te":"టమాట","kn":"ಟೊಮೇಟೊ","mr":"टोमॅटो"}'::jsonb,
   'Solanum lycopersicum', 'vegetable'),
  ('chilli', 'Chilli',
   '{"ta":"மிளகாய்","hi":"मिर्च","te":"మిర్చి","kn":"ಮೆಣಸಿನಕಾಯಿ","mr":"मिरची"}'::jsonb,
   'Capsicum annuum', 'vegetable'),
  ('cotton', 'Cotton',
   '{"ta":"பருத்தி","hi":"कपास","te":"పత్తి","kn":"ಹತ್ತಿ","mr":"कापूस"}'::jsonb,
   'Gossypium hirsutum', 'cash'),
  ('paddy', 'Paddy',
   '{"ta":"நெல்","hi":"धान","te":"వరి","kn":"ಭತ್ತ","mr":"भात"}'::jsonb,
   'Oryza sativa', 'cereal'),
  ('banana', 'Banana',
   '{"ta":"வாழை","hi":"केला","te":"అరటి","kn":"ಬಾಳೆ","mr":"केळी"}'::jsonb,
   'Musa spp.', 'fruit')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO crop_issues (crop_id, slug, type, name_en, name_local, scientific, symptoms, severity)
SELECT c.id, 'whitefly', 'pest', 'Whitefly / Leaf curl',
       '{"ta":"வெள்ளை ஈ","hi":"सफ़ेद मक्खी"}'::jsonb,
       'Bemisia tabaci',
       ARRAY['curled leaves','yellowing','small white insects on underside','sticky honeydew','sooty mould'],
       'medium'
FROM crops c WHERE c.slug = 'tomato'
ON CONFLICT (crop_id, slug) DO NOTHING;

INSERT INTO crop_issues (crop_id, slug, type, name_en, name_local, scientific, symptoms, severity)
SELECT c.id, 'early_blight', 'disease', 'Early blight',
       '{"ta":"முன்கூட்டிய இலை கருகல்","hi":"अगेती झुलसा"}'::jsonb,
       'Alternaria solani',
       ARRAY['concentric ring spots on lower leaves','yellow halo','defoliation from bottom upward'],
       'high'
FROM crops c WHERE c.slug = 'tomato'
ON CONFLICT (crop_id, slug) DO NOTHING;

INSERT INTO crop_issues (crop_id, slug, type, name_en, name_local, scientific, symptoms, severity)
SELECT c.id, 'thrips', 'pest', 'Thrips / Leaf curl',
       '{"ta":"த்ரிப்ஸ்","hi":"थ्रिप्स"}'::jsonb,
       'Scirtothrips dorsalis',
       ARRAY['upward leaf curl','silvery streaks','bronzing','flower drop'],
       'medium'
FROM crops c WHERE c.slug = 'chilli'
ON CONFLICT (crop_id, slug) DO NOTHING;

-- Placeholder products. SKUs and details to be replaced with real Kriya catalogue.
INSERT INTO products (sku, name, category, description, active_ingredients, certifications, msrp, pack_sizes, is_active) VALUES
  ('KR-NS-500', 'Kriya Neem Shakti', 'bio-pesticide',
   '{"en":"Organic neem-based bio-pesticide for sucking pests."}'::jsonb,
   ARRAY['Azadirachtin 1500 ppm'], ARRAY['PGS-Organic','Jaivik Bharat'],
   350, '[{"size":"500ml","price":350},{"size":"1L","price":650}]'::jsonb, TRUE),
  ('KR-TP-1KG', 'Kriya Trichoderma Plus', 'bio-fungicide',
   '{"en":"Trichoderma viride for soil-borne diseases and damping off."}'::jsonb,
   ARRAY['Trichoderma viride 2x10^9 CFU/g'], ARRAY['PGS-Organic'],
   280, '[{"size":"1kg","price":280}]'::jsonb, TRUE),
  ('KR-BS-500', 'Kriya Beauveria Shield', 'bio-pesticide',
   '{"en":"Beauveria bassiana for thrips and mites."}'::jsonb,
   ARRAY['Beauveria bassiana 1x10^8 CFU/g'], ARRAY['PGS-Organic'],
   400, '[{"size":"500g","price":400}]'::jsonb, TRUE)
ON CONFLICT (sku) DO NOTHING;

-- Recommendation mappings (PLACEHOLDER dosage; agronomy team must approve).
INSERT INTO product_recommendations
  (product_id, crop_issue_id, dosage, application, frequency, pre_harvest_interval_days, precautions, notes, rank, approved_by, approved_at)
SELECT p.id, i.id,
       '3 ml per litre of water',
       'Foliar spray on both sides of leaves',
       'Every 7 days, 2-3 sprays',
       3,
       ARRAY['Wear mask and gloves','Spray in early morning or evening','Avoid during peak flowering','Do not mix with chemical fungicides'],
       '{"en":"Effective on whitefly nymphs and adults; safe for pollinators when sprayed in low-light hours."}'::jsonb,
       10,
       'PLACEHOLDER - replace with agronomist sign-off',
       now()
FROM products p, crop_issues i
WHERE p.sku = 'KR-NS-500' AND i.slug = 'whitefly'
ON CONFLICT (product_id, crop_issue_id) DO NOTHING;

INSERT INTO product_recommendations
  (product_id, crop_issue_id, dosage, application, frequency, pre_harvest_interval_days, precautions, notes, rank, approved_by, approved_at)
SELECT p.id, i.id,
       '5 g per litre of water',
       'Soil drench around root zone + light foliar spray',
       'Every 10-14 days, 2 applications',
       0,
       ARRAY['Store cool and dry','Do not mix with chemical fungicides','Use within 6 months of opening'],
       '{"en":"Trichoderma colonises root zone and outcompetes Alternaria. Apply with adequate soil moisture."}'::jsonb,
       10,
       'PLACEHOLDER - replace with agronomist sign-off',
       now()
FROM products p, crop_issues i
WHERE p.sku = 'KR-TP-1KG' AND i.slug = 'early_blight'
ON CONFLICT (product_id, crop_issue_id) DO NOTHING;

INSERT INTO product_recommendations
  (product_id, crop_issue_id, dosage, application, frequency, pre_harvest_interval_days, precautions, notes, rank, approved_by, approved_at)
SELECT p.id, i.id,
       '5 g per litre of water',
       'Foliar spray, evening hours preferred',
       'Every 7 days, 2-3 sprays',
       3,
       ARRAY['Avoid mixing with chemical fungicides','Spray in evening for fungal viability','Wear mask and gloves'],
       '{"en":"Beauveria bassiana infects thrips through cuticle; needs humidity to act."}'::jsonb,
       10,
       'PLACEHOLDER - replace with agronomist sign-off',
       now()
FROM products p, crop_issues i
WHERE p.sku = 'KR-BS-500' AND i.slug = 'thrips'
ON CONFLICT (product_id, crop_issue_id) DO NOTHING;

-- Sample dealer
INSERT INTO dealers (name, phone, whatsapp_number, address, state, district, pincode, lat, lng, is_active)
VALUES ('Kriya Agri Centre - Coimbatore', '+919876500001', '+919876500001',
        '12, Town Hall Road, RS Puram', 'Tamil Nadu', 'Coimbatore', '641002',
        11.0168, 76.9558, TRUE)
ON CONFLICT DO NOTHING;
