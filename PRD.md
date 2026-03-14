⸻

ChainAtlas — Product Requirements Document (PRD)

1. Overview

ChainAtlas is a spatial interface for interacting with blockchains. Instead of navigating wallets and protocol dashboards through menus, users explore a 3D world where blockchains, bridges, and DeFi protocols exist as physical locations.

Users control an avatar that moves through this world. On-chain actions occur through spatial interactions:
• Walking into a swap building opens a swap interface.
• Crossing a bridge initiates cross-chain bridging.
• Entering a protocol building allows interaction with DeFi applications.

A user’s wallet balance is visualized through token companions (“minions”) that follow the avatar and participate visually in transactions.

The goal is to make crypto infrastructure intuitive, visible, and explorable.

⸻

2. Goals

Primary Goals 1. Make crypto interactions spatial and intuitive 2. Visualize wallet assets in a dynamic way 3. Enable protocol discovery through exploration 4. Create a shared environment where users interact with the crypto ecosystem

Secondary Goals
• Educational interface for new crypto users
• Marketing platform for protocols
• Visual block explorer for on-chain activity

⸻

3. Target Users

1. Crypto Native Users
   • DeFi users
   • NFT collectors
   • traders

Goal: provide a fun, visual interface for interacting with existing protocols.

2. New Crypto Users
   • people unfamiliar with DeFi
   • people intimidated by wallets

Goal: learn by exploration instead of documentation.

3. Protocol Teams

Goal: discoverability and branding inside the world.

⸻

4. Core Concept

ChainAtlas translates blockchain infrastructure into physical metaphors.

Blockchain Concept Spatial Representation
Blockchain Island / City
Bridge Physical bridge
DEX Marketplace building
Lending protocol Bank building
Liquidity pool Pool / fountain
Wallet Avatar + token minions
Transaction Movement / interaction

⸻

5. Core Features

5.1 Avatar & World Navigation

Users control an avatar that moves through the world.

Movement:
• keyboard movement (WASD)
• camera rotation
• click interaction

Users spawn in a central hub area.

⸻

5.2 Chain Worlds

Each blockchain is represented as a separate location.

Example worlds:
• Ethereum City
• Solana District
• Base Island
• Arbitrum Valley

Each world contains protocol buildings native to that ecosystem.

⸻

5.3 Bridges (Cross-Chain Movement)

Bridges connect blockchain worlds.

Interaction flow: 1. User walks to bridge entrance 2. UI shows supported chains 3. User selects destination chain 4. Bridge transaction executed 5. Avatar appears in destination world

Visual:

Users walk across the bridge while the transaction confirms.

⸻

5.4 Token Minions (Wallet Visualization)

Each token held in a wallet appears as a visual companion following the avatar.

Example:

Token Minion Representation
ETH glowing spirit
USDC small banker robot
SOL energy particle
Meme tokens playful creatures

Minions represent token groups, not individual tokens.

Example:

1500 USDC → 1 USDC companion

⸻

5.5 Transaction Visualization

When transactions occur, minions visually participate.

Swap

Input token minions enter swap machine.

Output token minions exit.

Bridge

Minions walk across the bridge.

Send

Minions move from one avatar to another.

Liquidity

Minions jump into a pool structure.

⸻

5.6 Protocol Buildings

Each protocol exists as a location.

Examples:

DEX → marketplace
lending → bank
NFT market → gallery

When entering a building:
• UI overlay opens
• transaction interface appears

Protocols can provide their own branded environments.

⸻

5.7 Multiplayer Layer

Users can see other avatars in the world.

Social features:
• visible token minions
• avatar proximity chat (optional)
• wallet viewing (optional)

This creates visible crypto identity.

⸻

6. Monetization

6.1 Sponsored Locations

Protocols can pay for:
• buildings
• plaza placement
• branded environments

Example:

Uniswap Plaza
Sponsored by Uniswap Labs

⸻

6.2 Premium Placement

Protocols pay to appear:
• closer to spawn
• larger structures
• featured buildings

⸻

6.3 Event Spaces

Protocols host events:
• token launches
• liquidity campaigns
• community meetups

⸻

7. Technical Architecture

Frontend

Primary technologies:
• React Three Fiber
• Three.js
• Next.js

Responsibilities:
• world rendering
• avatar movement
• building interaction
• token visualization

⸻

Blockchain Interaction

Libraries:
• wagmi
• viem
• wallet connect

Capabilities:
• swap
• bridge
• send
• contract interactions

⸻

Backend

Light backend for:
• world state
• multiplayer synchronization
• protocol registry

Technologies:
• Node.js
• WebSockets
• Redis

⸻

8. MVP Scope

Initial MVP should focus on simplicity.

Chains
• Ethereum
• Base

Actions
• swap
• bridge
• send

Locations
• central plaza
• swap building
• bridge

Token Visualization
• basic minion system

⸻

9. User Flow (Example)

Swap Tokens 1. User enters world 2. walks to swap marketplace 3. UI opens 4. user signs transaction 5. minions enter machine 6. new token minions appear

⸻

Bridge Tokens 1. user walks to bridge 2. selects destination chain 3. confirms transaction 4. avatar crosses bridge 5. appears in destination world

⸻

10. Success Metrics

Adoption
• daily active users
• session duration

Engagement
• average time exploring world
• number of protocol interactions

Monetization
• sponsored locations
• protocol integrations

⸻

11. Risks

Performance

3D environments can be heavy for browsers.

Mitigation:
• low poly assets
• simplified world design

UX Speed

Walking may slow down interactions.

Mitigation:
• teleport shortcuts
• quick action menus

Security

Wallet transactions must remain clear and explicit.

Mitigation:
• standard wallet confirmations
• clear UI overlays

⸻

12. Future Expansion

Chain Map Expansion

Add more blockchain worlds.

AI Agents

Autonomous agents interacting with protocols.

On-chain Visualization

Transactions appearing live in the world.

NFT Characters

NFTs becoming playable avatars.

⸻

Summary

ChainAtlas transforms blockchain infrastructure into a spatial environment where users explore networks, visualize assets, and interact with protocols through movement.

By turning abstract crypto mechanics into visible interactions, ChainAtlas aims to make decentralized systems more intuitive, social, and discoverable.

⸻
