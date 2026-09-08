# SIH26034 - Software System to Check Compliance of Packaged Commodities

## Team modules

`frontend/`  
Frontend/UI

`backend/`  
Main API and integration/orchestration

`ocr/`  
OCR and computer vision

`extraction/`  
Extract MRP, net quantity, manufacturer, packing date, and consumer care information from OCR output

`rules/`  
Compliance rules and PASS/FAIL logic

`report/`  
Compliance report/PDF generation

`contracts/`  
Shared JSON formats between modules

`test-data/`  
Sample inputs and outputs for testing

## Basic data flow

Package Image  
→ Backend  
→ OCR  
→ Extraction  
→ Rules  
→ Compliance Result  
→ Frontend/Report

## Locked declaration field names

- `mrp`
- `net_quantity`
- `manufacturer`
- `packing_date`
- `consumer_care`
