const { assert, expect } = require("chai")
const { deployments, ethers, network } = require("hardhat")
const { developmentChains } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Roulette", async function () {
          let deployer,
              bettor,
              roulette,
              vrfCoordinatorV2Mock,
              mockUSDC,
              betSize,
              decimals
          beforeEach(async function () {
              accounts = await ethers.getSigners()
              deployer = accounts[0]
              bettor = accounts[1]
              await deployments.fixture(["all"])
              roulette = await ethers.getContract("Roulette", deployer.address)
              vrfCoordinatorV2Mock = await ethers.getContract(
                  "VRFCoordinatorV2Mock",
                  deployer.address
              )
              mockUSDC = await ethers.getContract("MockUSDC", deployer.address)
              decimals = await mockUSDC.decimals()
              betSize = 1 * 10 ** decimals // $1
              const maxUint256 = ethers.BigNumber.from(
                  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
              )
              await mockUSDC.approve(roulette.address, maxUint256)
              await mockUSDC
                  .connect(bettor)
                  .approve(roulette.address, maxUint256)
              await mockUSDC.transfer(roulette.address, betSize * 35) // 35 to 1 is max payout
          })

          describe("bet", async function () {
              it("should accept a bet and fire the event", async function () {
                  const deployerInitialBalance = await mockUSDC.balanceOf(
                      deployer.address
                  )
                  await new Promise(async (resolve, reject) => {
                      roulette.once(
                          "BetPlaced",
                          async (bettor, betAmount, betId) => {
                              try {
                                  assert.equal(bettor, deployer.address)
                                  assert.equal(
                                      betAmount.toString(),
                                      betSize.toString()
                                  )
                                  assert.equal(betId.toString(), "0")
                                  const deployerEndBalance =
                                      await mockUSDC.balanceOf(deployer.address)
                                  assert.equal(
                                      deployerEndBalance.toString(),
                                      deployerInitialBalance
                                          .sub(betSize)
                                          .toString()
                                  )
                                  assert.equal(
                                      (
                                          await roulette.getCountBets()
                                      ).toString(),
                                      "1"
                                  )
                              } catch (e) {
                                  reject(e)
                              }
                              resolve()
                          }
                      )
                      await roulette.bet(betSize, 0)
                  })
              })
              it("should revert if betting is closed", async function () {
                  await roulette.bet(betSize, 0)
                  await roulette.requestRandomWords()
                  await expect(
                      roulette.bet(betSize, 0)
                  ).to.be.revertedWithCustomError(
                      roulette,
                      "Roulette__BettingClosed"
                  )
              })
              it("should revert if bet size too small", async function () {
                  await expect(
                      roulette.bet(1, 0)
                  ).to.be.revertedWithCustomError(
                      roulette,
                      "Roulette__BetTooSmall"
                  )
              })
              it("should revert if bet size too large", async function () {
                  await roulette.setMaxBet(betSize - 1)
                  await expect(
                      roulette.bet(betSize, 0)
                  ).to.be.revertedWithCustomError(
                      roulette,
                      "Roulette__BetTooLarge"
                  )
              })
          })

          describe("requestRandomWords", function () {
              it("should fire event and update state variables", async function () {
                  await expect(roulette.requestRandomWords()).to.emit(
                      roulette,
                      "RandomWordsRequested"
                  )
                  const acceptingBets = await roulette.getAcceptingBets()
                  assert(!acceptingBets)
              })
          })

          describe("settleRound", function () {
              // winning numbers in order:
              // 28, 12, 31, 13, 23
              //  B,  R,  B,  B,  R
              it("should settle winning black, red, and number bet", async function () {
                  // place bet (on black)
                  await roulette.bet(betSize, 38)
                  let deployerStartBalance = await mockUSDC.balanceOf(
                      deployer.address
                  )
                  // settle
                  await new Promise(async (resolve, reject) => {
                      roulette.once("RoundSettled", async () => {
                          try {
                              assert(await roulette.getAcceptingBets())
                              assert.equal(
                                  (await roulette.getCountBets()).toString(),
                                  "0"
                              )
                              let deployerEndBalance = await mockUSDC.balanceOf(
                                  deployer.address
                              )
                              assert(
                                  deployerEndBalance.toString(),
                                  deployerStartBalance
                                      .add(betSize * 2)
                                      .toString()
                              )
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })
                      const txResponse = await roulette.requestRandomWords()
                      const txReceipt = await txResponse.wait(1)
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          roulette.address
                      )
                  })
                  // place bet (on red)
                  await roulette.bet(betSize, 37)
                  deployerStartBalance = await mockUSDC.balanceOf(
                      deployer.address
                  )
                  // settle
                  await new Promise(async (resolve, reject) => {
                      roulette.once("RoundSettled", async () => {
                          try {
                              assert(await roulette.getAcceptingBets())
                              assert.equal(
                                  (await roulette.getCountBets()).toString(),
                                  "0"
                              )
                              deployerEndBalance = await mockUSDC.balanceOf(
                                  deployer.address
                              )
                              assert(
                                  deployerEndBalance.toString(),
                                  deployerStartBalance
                                      .add(betSize * 2)
                                      .toString()
                              )
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })
                      const txResponse = await roulette.requestRandomWords()
                      const txReceipt = await txResponse.wait(1)
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          roulette.address
                      )
                  })
                  // place bet (on number 31)
                  await roulette.bet(betSize, 31)
                  deployerStartBalance = await mockUSDC.balanceOf(
                      deployer.address
                  )
                  // make sure contract is funded
                  await mockUSDC.transfer(roulette.address, 35 * betSize)
                  // settle
                  await new Promise(async (resolve, reject) => {
                      roulette.once("RoundSettled", async () => {
                          try {
                              assert(await roulette.getAcceptingBets())
                              assert.equal(
                                  (await roulette.getCountBets()).toString(),
                                  "0"
                              )
                              deployerEndBalance = await mockUSDC.balanceOf(
                                  deployer.address
                              )
                              assert(
                                  deployerEndBalance.toString(),
                                  deployerStartBalance
                                      .add(betSize * 36)
                                      .toString()
                              )
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })
                      const txResponse = await roulette.requestRandomWords()
                      const txReceipt = await txResponse.wait(1)
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          roulette.address
                      )
                  })
                  // place bet (on number 0)
                  await roulette.bet(betSize, 0)
                  deployerStartBalance = await mockUSDC.balanceOf(
                      deployer.address
                  )
                  // settle
                  await new Promise(async (resolve, reject) => {
                      roulette.once("RoundSettled", async () => {
                          try {
                              assert(await roulette.getAcceptingBets())
                              assert.equal(
                                  (await roulette.getCountBets()).toString(),
                                  "0"
                              )
                              deployerEndBalance = await mockUSDC.balanceOf(
                                  deployer.address
                              )
                              assert(
                                  deployerEndBalance.toString(),
                                  deployerStartBalance.toString()
                              )
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })
                      const txResponse = await roulette.requestRandomWords()
                      const txReceipt = await txResponse.wait(1)
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          roulette.address
                      )
                  })
              })
          })

          describe("withdraw", async function () {
              it("should withdraw usdc", async function () {
                  await mockUSDC.transfer(roulette.address, betSize)
                  const deployerStartBalance = await mockUSDC.balanceOf(
                      deployer.address
                  )
                  const contractStartBalance = await roulette.getBalance()
                  await roulette.withdraw(betSize)
                  const deployerEndBalance = await mockUSDC.balanceOf(
                      deployer.address
                  )
                  const contractEndBalance = await roulette.getBalance()
                  assert.equal(
                      deployerEndBalance.toString(),
                      deployerStartBalance.add(betSize).toString()
                  )
                  assert.equal(
                      contractEndBalance.toString(),
                      contractStartBalance.sub(betSize).toString()
                  )
              })
              it("should revert if amount too high", async function () {
                  const contractBalance = await roulette.getBalance()
                  await expect(
                      roulette.withdraw(contractBalance * 2)
                  ).to.be.revertedWith("ERC20: transfer amount exceeds balance")
              })
              it("should only let the owner withdraw", async function () {
                  await expect(
                      roulette.connect(bettor).withdraw(10)
                  ).to.be.revertedWith("Ownable: caller is not the owner")
              })
          })

          describe("getters", function () {
              it("should get min bet", async function () {
                  assert.equal(
                      (await roulette.getMinBet()).toString(),
                      "1000000"
                  )
              })
              it("should get max bet", async function () {
                  assert.equal(
                      (await roulette.getMaxBet()).toString(),
                      "5000000000"
                  )
              })
          })

          describe("setters", function () {
              it("should set min bet", async function () {
                  const newMinBet = 1000
                  await roulette.setMinBet(newMinBet)
                  assert.equal(
                      (await roulette.getMinBet()).toString(),
                      newMinBet.toString()
                  )
              })
              it("should only let owner set min bet", async function () {
                  await expect(
                      roulette.connect(bettor).setMinBet(1000)
                  ).to.be.revertedWith("Ownable: caller is not the owner")
              })
              it("should set max bet", async function () {
                  const newMaxBet = 1000
                  await roulette.setMaxBet(newMaxBet)
                  assert.equal(
                      (await roulette.getMaxBet()).toString(),
                      newMaxBet.toString()
                  )
              })
              it("should only let owner set max bet", async function () {
                  await expect(
                      roulette.connect(bettor).setMaxBet(1000)
                  ).to.be.revertedWith("Ownable: caller is not the owner")
              })
          })
      })
