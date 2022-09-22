// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Need to use a keeper
// Currently only one zero

error Roulette__BettingClosed();
error Roulette__BetTooSmall();
error Roulette__BetTooLarge();

contract Roulette is VRFConsumerBaseV2, Ownable {
    enum Colour {
        RED,
        BLACK,
        GREEN
    }

    // debugging
    uint8 public s_winningNumber;

    ERC20 private USDC;

    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    bytes32 private immutable i_keyHash;
    uint64 private immutable i_subscriptionId;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private constant CALLBACK_GAS_LIMIT = 800000;
    uint32 private constant NUM_WORDS = 1;
    address private s_vaultAddress;

    address private immutable i_owner;
    bool private s_acceptingBets;
    uint256 private s_minimumBet;
    uint256 private s_maximumBet;
    Bet[] private s_openBets;

    mapping(uint256 => Colour) private numToColour;

    struct Bet {
        address bettor;
        uint256 betAmount;
        uint8 betId;
    }

    event BetPlaced(address bettor, uint256 betAmount, uint8 betId);
    event RandomWordsRequested(uint256 requestId);
    event RoundSettled();

    constructor(
        address _vrfCoordinatorAddress,
        bytes32 _keyHash,
        uint64 _subscriptionId,
        address _vaultAddress,
        address _usdcAddress
    ) VRFConsumerBaseV2(_vrfCoordinatorAddress) {
        USDC = ERC20(_usdcAddress);
        i_vrfCoordinator = VRFCoordinatorV2Interface(_vrfCoordinatorAddress);
        i_keyHash = _keyHash;
        i_subscriptionId = _subscriptionId;
        s_vaultAddress = _vaultAddress;
        i_owner = msg.sender;
        s_acceptingBets = true;
        s_minimumBet = 1000000; // $1
        s_maximumBet = 5000000000; // $5,000
        uint8[19] memory RED_NUMBERS = [
            1,
            3,
            5,
            7,
            9,
            12,
            14,
            16,
            18,
            19,
            21,
            23,
            25,
            27,
            30,
            32,
            34,
            36,
            37
        ];
        numToColour[0] = Colour.GREEN;
        for (uint8 i = 1; i <= 38; i++) {
            numToColour[i] = Colour.BLACK;
        }
        for (uint8 i; i < RED_NUMBERS.length; i++) {
            numToColour[RED_NUMBERS[i]] = Colour.RED;
        }
    }

    /*
    betId:
    - 0-36 = number
    - 37 = red
    - 38 = black
    */
    function bet(uint256 _betAmount, uint8 _betId) external {
        if (!s_acceptingBets) {
            revert Roulette__BettingClosed();
        }
        if (_betAmount < s_minimumBet) {
            revert Roulette__BetTooSmall();
        }
        if (_betAmount > s_maximumBet) {
            revert Roulette__BetTooLarge();
        }
        USDC.transferFrom(msg.sender, address(this), _betAmount);
        s_openBets.push(Bet(msg.sender, _betAmount, _betId));
        emit BetPlaced(msg.sender, _betAmount, _betId);
    }

    // Keeper will call this function in future implementation
    function requestRandomWords() public /* internal */
    {
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_keyHash,
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            CALLBACK_GAS_LIMIT,
            NUM_WORDS
        );
        emit RandomWordsRequested(requestId);
        s_acceptingBets = false;
    }

    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords)
        internal
        override
    {
        settleRound(requestId, randomWords);
    }

    function settleRound(
        uint256, /* requestId */
        uint256[] memory randomWords
    ) internal {
        uint256 winningNumber = randomWords[0] % 37;
        Colour winningColour = numToColour[winningNumber];
        // settle bets
        for (uint8 i; i < s_openBets.length; i++) {
            Bet memory currentBet = s_openBets[i];
            address bettor = currentBet.bettor;
            uint8 betId = currentBet.betId;
            uint256 betAmount = currentBet.betAmount;
            if (betId == winningNumber) {
                USDC.transfer(bettor, 36 * betAmount);
            } else if (betId == 37 && winningColour == Colour.RED) {
                USDC.transfer(bettor, 2 * betAmount);
            } else if (betId == 38 && winningColour == Colour.BLACK) {
                USDC.transfer(bettor, 2 * betAmount);
            }
        }
        s_winningNumber = uint8(winningNumber);
        emit RoundSettled();
        s_acceptingBets = true;
        delete s_openBets;
    }

    function withdraw(uint256 _withdrawAmount) external onlyOwner {
        USDC.transfer(i_owner, _withdrawAmount);
    }

    // Getters

    function getBalance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    function getMinBet() external view returns (uint256) {
        return s_minimumBet;
    }

    function getMaxBet() external view returns (uint256) {
        return s_maximumBet;
    }

    function getAcceptingBets() external view returns (bool) {
        return s_acceptingBets;
    }

    function getCountBets() external view returns (uint256) {
        return s_openBets.length;
    }

    // Setters

    function setMinBet(uint256 _newMinBet) external onlyOwner {
        s_minimumBet = _newMinBet;
    }

    function setMaxBet(uint256 _newMaxBet) external onlyOwner {
        s_maximumBet = _newMaxBet;
    }
}
