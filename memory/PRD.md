# L'Épicurien — Mobile Ordering App

## Overview
A French-language hybrid grocery + food-delivery mobile app built with Expo Router. Guests can browse a catalog, add items to a persistent cart, and place orders with delivery to an address. No authentication, no payment integration (paiement à la livraison simulé).

## User Choices
- **Type**: Hybride Épicerie/Supermarché + Restaurant/Food delivery
- **Auth**: Aucune (commande invité, identifié via guest_id local)
- **Paiement**: Aucun (paiement à la livraison simulé)
- **Design**: Minimaliste & moderne coloré (coral/tomato accent)
- **Langue**: Français

## Architecture
- **Frontend**: Expo Router (file-based), React Native, TypeScript
- **Backend**: FastAPI + Motor (MongoDB async driver)
- **Storage**: MongoDB (categories, products, orders); AsyncStorage (cart, guest_id)

## Navigation (Bottom Tabs)
- `/(tabs)/home` — Accueil (hero promo, catégories, populaires, promotions)
- `/(tabs)/catalog` — Catalogue (recherche + chips + grille 2 colonnes)
- `/(tabs)/cart` — Panier (steppers, sous-total/livraison/total)
- `/(tabs)/orders` — Commandes (historique invité)
- `/product/[id]` — Détail produit (stepper + Ajouter au panier)
- `/checkout` — Validation commande (formulaire + résumé + écran de succès)

## Backend API (`/api`)
| Method | Path | Description |
|---|---|---|
| GET | `/categories` | Liste des 8 catégories seedées |
| GET | `/products` | Liste produits, filtres: `category_id`, `kind`, `search`, `popular`, `promo` |
| GET | `/products/{id}` | Détail produit |
| POST | `/orders` | Crée une commande (calcule subtotal + livraison) |
| GET | `/orders?guest_id=…` | Liste commandes d'un invité |
| GET | `/orders/{id}` | Détail commande |

### Business Rules
- Livraison: **2,99 €** si sous-total < 30 €, **offerte** si ≥ 30 €
- Statut par défaut: `En préparation`
- 18 produits seedés (burgers, pizzas, salades, boissons, fruits & légumes, boulangerie, laitiers, épicerie)

## Cart State
- Persisté dans AsyncStorage (`cart_items_v1`)
- `guest_id_v1` généré une fois et conservé pour retrouver les commandes
- Quantité +/-, suppression, total réactif, badge dans la tab bar

## Tested
- ✅ Backend pytest 22/22 (initial 16 + loyalty/timeline 6)
- ✅ E2E frontend complet incluant fidélité et timeline

## Loyalty Program (1€ tous les 10€)
- Tracked via `loyalty` collection per `guest_id`
- `points_earned = floor((subtotal - points_used) / 10) * 1€`
- Usable at checkout via "Utiliser ma fidélité" toggle (`use_points` in POST /orders body)
- Free-delivery threshold uses discounted subtotal
- Balance affiché à la commande + crédité dans le détail commande

## Order Status Timeline
- 3 étapes : *En préparation* → *En livraison* → *Livré*
- Status computed côté backend depuis `created_at` :
  - < 3 min: En préparation
  - 3-10 min: En livraison
  - ≥ 10 min: Livré
- Page `/order/[id]` avec timeline visuelle, poll auto toutes les 15s jusqu'à livraison

## Future Enhancements
- Filtre Restaurant vs Épicerie au niveau de l'onglet Catalogue
- Programme parrainage (revenu incrémental)
