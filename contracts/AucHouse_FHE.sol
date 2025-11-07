pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AucHouse_FHE is ZamaEthereumConfig {
    
    struct AuctionItem {
        string itemId;                  
        euint32 encryptedBid;           
        uint256 publicBid;              
        uint256 startTime;              
        uint256 endTime;                
        string description;             
        address bidder;                 
        uint256 timestamp;              
        uint32 decryptedBid;            
        bool isVerified;                
    }
    
    mapping(string => AuctionItem) public auctionItems;
    string[] public itemIds;
    
    event BidPlaced(string indexed itemId, address indexed bidder);
    event BidDecrypted(string indexed itemId, uint32 decryptedBid);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function placeBid(
        string calldata itemId,
        externalEuint32 encryptedBid,
        bytes calldata inputProof,
        uint256 publicBid,
        uint256 startTime,
        uint256 endTime,
        string calldata description
    ) external {
        require(bytes(auctionItems[itemId].description).length == 0, "Item already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedBid, inputProof)), "Invalid encrypted bid");
        
        auctionItems[itemId] = AuctionItem({
            itemId: itemId,
            encryptedBid: FHE.fromExternal(encryptedBid, inputProof),
            publicBid: publicBid,
            startTime: startTime,
            endTime: endTime,
            description: description,
            bidder: msg.sender,
            timestamp: block.timestamp,
            decryptedBid: 0,
            isVerified: false
        });
        
        FHE.allowThis(auctionItems[itemId].encryptedBid);
        FHE.makePubliclyDecryptable(auctionItems[itemId].encryptedBid);
        
        itemIds.push(itemId);
        emit BidPlaced(itemId, msg.sender);
    }
    
    function verifyBidDecryption(
        string calldata itemId, 
        bytes memory abiEncodedClearBid,
        bytes memory decryptionProof
    ) external {
        require(bytes(auctionItems[itemId].description).length > 0, "Item does not exist");
        require(!auctionItems[itemId].isVerified, "Bid already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(auctionItems[itemId].encryptedBid);
        
        FHE.checkSignatures(cts, abiEncodedClearBid, decryptionProof);
        
        uint32 decodedBid = abi.decode(abiEncodedClearBid, (uint32));
        
        auctionItems[itemId].decryptedBid = decodedBid;
        auctionItems[itemId].isVerified = true;
        
        emit BidDecrypted(itemId, decodedBid);
    }
    
    function getEncryptedBid(string calldata itemId) external view returns (euint32) {
        require(bytes(auctionItems[itemId].description).length > 0, "Item does not exist");
        return auctionItems[itemId].encryptedBid;
    }
    
    function getAuctionItem(string calldata itemId) external view returns (
        uint256 publicBid,
        uint256 startTime,
        uint256 endTime,
        string memory description,
        address bidder,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedBid
    ) {
        require(bytes(auctionItems[itemId].description).length > 0, "Item does not exist");
        AuctionItem storage item = auctionItems[itemId];
        
        return (
            item.publicBid,
            item.startTime,
            item.endTime,
            item.description,
            item.bidder,
            item.timestamp,
            item.isVerified,
            item.decryptedBid
        );
    }
    
    function getAllItemIds() external view returns (string[] memory) {
        return itemIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


