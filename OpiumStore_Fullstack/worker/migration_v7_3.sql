-- V7.3 : répare les textes UTF-8 précédemment envoyés à D1 avec un mauvais encodage.
-- Ce fichier est idempotent et peut être exécuté plusieurs fois.

UPDATE item_catalog SET name='Coffre commun',emoji='📦',description='Récompenses courantes et petits bonus.',updated_at=unixepoch()*1000 WHERE item_key='chest_common';
UPDATE item_catalog SET name='Coffre rare',emoji='🔷',description='Récompenses améliorées avec plus de chances de bonus.',updated_at=unixepoch()*1000 WHERE item_key='chest_rare';
UPDATE item_catalog SET name='Coffre épique',emoji='🟣',description='Gains importants, boosts et objets cosmétiques.',updated_at=unixepoch()*1000 WHERE item_key='chest_epic';
UPDATE item_catalog SET name='Coffre légendaire',emoji='🟡',description='Très gros gains et récompenses exclusives.',updated_at=unixepoch()*1000 WHERE item_key='chest_legendary';
UPDATE item_catalog SET name='Coffre événementiel',emoji='🌍',description='Récompenses spéciales liées aux événements.',updated_at=unixepoch()*1000 WHERE item_key='chest_event';
UPDATE item_catalog SET name='Ticket de roue',emoji='🎟️',description='Permet de tourner la roue même pendant le cooldown.',updated_at=unixepoch()*1000 WHERE item_key='wheel_ticket';
UPDATE item_catalog SET name='Boost XP ×2',emoji='🔥',description='Double l’XP gagnée pendant 60 minutes.',updated_at=unixepoch()*1000 WHERE item_key='xp_boost_2x';
UPDATE item_catalog SET name='Protecteur de série',emoji='🛡️',description='Protège automatiquement une série après un seul jour manqué.',updated_at=unixepoch()*1000 WHERE item_key='streak_protector';
UPDATE item_catalog SET name='Pionnier',emoji='🚀',description='Titre réservé aux premiers membres du système de progression.',updated_at=unixepoch()*1000 WHERE item_key='title_pioneer';
UPDATE item_catalog SET name='Vétéran',emoji='🏆',description='Titre obtenu en progressant régulièrement.',updated_at=unixepoch()*1000 WHERE item_key='title_veteran';
UPDATE item_catalog SET name='Légende Opium',emoji='👑',description='Titre prestigieux réservé aux meilleurs niveaux.',updated_at=unixepoch()*1000 WHERE item_key='title_legend';
UPDATE item_catalog SET name='Aura rouge',emoji='🔴',description='Ajoute une aura rouge au profil.',updated_at=unixepoch()*1000 WHERE item_key='cosmetic_red_aura';
UPDATE item_catalog SET name='Cadre néon',emoji='💠',description='Cadre de profil lumineux.',updated_at=unixepoch()*1000 WHERE item_key='cosmetic_neon_frame';
UPDATE item_catalog SET name='Couronne animée',emoji='👑',description='Cosmétique légendaire pour le profil.',updated_at=unixepoch()*1000 WHERE item_key='cosmetic_crown';
UPDATE item_catalog SET name='Jeton événementiel',emoji='🌐',description='Objet de collection obtenu pendant un événement communautaire.',updated_at=unixepoch()*1000 WHERE item_key='event_token';

UPDATE missions SET title='Première génération',description='Utilise le générateur une fois.',updated_at=unixepoch()*1000 WHERE id='classic-first-gen';
UPDATE missions SET title='Habitué du générateur',description='Effectue 10 générations.',updated_at=unixepoch()*1000 WHERE id='classic-gen-10';
UPDATE missions SET title='Machine à générer',description='Effectue 50 générations.',updated_at=unixepoch()*1000 WHERE id='classic-gen-50';
UPDATE missions SET title='Tour de chance',description='Utilise la roue une fois.',updated_at=unixepoch()*1000 WHERE id='classic-first-wheel';
UPDATE missions SET title='Chasseur de coffres',description='Ouvre 3 coffres.',updated_at=unixepoch()*1000 WHERE id='classic-open-3';
UPDATE missions SET title='Premier achat',description='Achète un article dans la Boutique points.',updated_at=unixepoch()*1000 WHERE id='classic-shop';
UPDATE missions SET title='Une semaine fidèle',description='Récupère 7 récompenses quotidiennes.',updated_at=unixepoch()*1000 WHERE id='classic-daily-7';
UPDATE missions SET title='Générateur actif',description='Effectue 5 générations cette semaine.',updated_at=unixepoch()*1000 WHERE id='weekly-gen-5';
UPDATE missions SET title='Chance régulière',description='Utilise la roue 3 fois cette semaine.',updated_at=unixepoch()*1000 WHERE id='weekly-wheel-3';
UPDATE missions SET title='Ouverture hebdomadaire',description='Ouvre 2 coffres cette semaine.',updated_at=unixepoch()*1000 WHERE id='weekly-chest-2';
UPDATE missions SET title='Connexion régulière',description='Récupère 5 récompenses quotidiennes cette semaine.',updated_at=unixepoch()*1000 WHERE id='weekly-daily-5';

UPDATE level_rewards SET label='Bienvenue dans la progression' WHERE level=2;
UPDATE level_rewards SET label='Titre Pionnier' WHERE level=3;
UPDATE level_rewards SET label='Palier niveau 5' WHERE level=5;
UPDATE level_rewards SET label='Palier niveau 10' WHERE level=10;
UPDATE level_rewards SET label='Titre Vétéran' WHERE level=15;
UPDATE level_rewards SET label='Palier niveau 20' WHERE level=20;
UPDATE level_rewards SET label='Titre Légende Opium' WHERE level=30;

UPDATE community_events SET title='Objectif communautaire de lancement',description='La communauté doit effectuer 1 000 générations.',emoji='🌍',updated_at=unixepoch()*1000 WHERE id='community-launch';
UPDATE promo_codes SET description='Code de lancement du système de progression.',updated_at=unixepoch()*1000 WHERE code='OPIUM2026';
